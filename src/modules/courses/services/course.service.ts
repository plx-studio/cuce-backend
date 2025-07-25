import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../../supabase/supabase.service';
import { CourseType, CreateCourseDto } from '../dto/create-course.dto';
import { UpdateCourseDto } from '../dto/update-course.dto';
import { EnrolledStudent, SupabaseEnrollment } from '../types/course.types';

@Injectable()
export class CourseService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private getDefaultCapacity(courseType: CourseType): number {
    switch (courseType) {
      case CourseType.UNDERGRADUATE:
        return 4;
      case CourseType.GRADUATE:
        return 3;
      case CourseType.MASTERS:
        return 2;
      case CourseType.DOCTORATE:
        return 1;
      default:
        return 4; // Default fallback
    }
  }

  async create(createCourseDto: CreateCourseDto, accessToken: string) {
    const defaultCapacity = this.getDefaultCapacity(
      createCourseDto.course_type,
    );

    const courseData = {
      course_title: createCourseDto.course_title,
      course_code: createCourseDto.course_code,
      course_credits: createCourseDto.course_credits,
      course_type: createCourseDto.course_type,
      default_capacity: defaultCapacity,
    };
    return this.supabaseService.insert(accessToken, 'courses', courseData);
  }

  async findAll(accessToken: string) {
    // Get all courses with their enrollments and program associations
    const { data: courses, error } = await this.supabaseService
      .getClientWithAuth(accessToken)
      .from('courses').select(`
        *,
        enrollments (
          student_id,
          enrollment_status
        ),
        program_courses (
          program_id
        )
      `);

    if (error) {
      throw new Error(`Failed to fetch courses: ${error.message}`);
    }

    // Process each course to calculate unique stats
    const processedCourses = courses.map((course) => {
      // Get unique student IDs from approved, active, or completed enrollments
      const uniqueEnrolledStudents = new Set(
        (course.enrollments || [])
          .filter((enrollment) =>
            ['APPROVED', 'ACTIVE', 'COMPLETED'].includes(
              enrollment.enrollment_status,
            ),
          )
          .map((enrollment) => enrollment.student_id),
      );

      // Get unique program IDs
      const uniquePrograms = new Set(
        (course.program_courses || []).map((pc) => pc.program_id),
      );

      // Remove the raw arrays from the response
      const { enrollments, program_courses, ...courseData } = course;

      return {
        ...courseData,
        total_enrolled_students: uniqueEnrolledStudents.size,
        total_programs: uniquePrograms.size,
      };
    });

    return processedCourses;
  }

  async findOne(id: string, accessToken: string) {
    const result = await this.supabaseService.select(accessToken, 'courses', {
      filter: { course_id: id },
    });

    if (!result || result.length === 0) {
      throw new NotFoundException(`Course with ID ${id} not found`);
    }

    return result[0];
  }

  async update(
    id: string,
    updateCourseDto: UpdateCourseDto,
    accessToken: string,
  ) {
    // First check if course exists
    await this.findOne(id, accessToken);

    const updateData: any = {
      ...updateCourseDto,
    };

    // If course_type is being updated, recalculate default_capacity
    if (updateCourseDto.course_type) {
      updateData.default_capacity = this.getDefaultCapacity(
        updateCourseDto.course_type,
      );
    }

    return this.supabaseService.update(
      accessToken,
      'courses',
      { course_id: id },
      updateData,
    );
  }

  async delete(id: string, accessToken: string) {
    // First check if course exists
    await this.findOne(id, accessToken);

    // Check if course has any enrollments
    const { data: enrollments, error: enrollmentError } =
      await this.supabaseService
        .getClientWithAuth(accessToken)
        .from('enrollments')
        .select('enrollment_id')
        .eq('course_id', id)
        .limit(1);

    if (enrollmentError) {
      throw new InternalServerErrorException(
        `Failed to check course enrollments: ${enrollmentError.message}`,
      );
    }

    if (enrollments && enrollments.length > 0) {
      throw new BadRequestException(
        'Cannot delete course with existing enrollments',
      );
    }

    // If no enrollments exist, proceed with deletion
    const { error: deleteError } = await this.supabaseService
      .getClientWithAuth(accessToken)
      .from('courses')
      .delete()
      .eq('course_id', id);

    if (deleteError) {
      throw new InternalServerErrorException(
        `Failed to delete course: ${deleteError.message}`,
      );
    }

    return {
      success: true,
      message: `Course with ID ${id} has been deleted successfully`,
    };
  }

  async getAffiliatedPrograms(id: string, accessToken: string) {
    // First check if course exists
    await this.findOne(id, accessToken);

    // Get all programs associated with this course
    const { data: programs, error } = await this.supabaseService
      .getClientWithAuth(accessToken)
      .from('program_courses')
      .select(
        `
        program:programs (
          program_id,
          program_name,
          program_type,
          total_credits,
          student:students (
            student_id,
            reg_number)
        )
      `,
      )
      .eq('course_id', id);

    if (error) {
      throw new InternalServerErrorException(
        `Failed to fetch affiliated programs: ${error.message}`,
      );
    }

    if (!programs || programs.length === 0) {
      throw new NotFoundException(`No programs found for course with ID ${id}`);
    }

    return programs.map((pc) => pc.program);
  }

  async getAffiliatedSessions(id: string, accessToken: string) {
    // First check if course exists
    await this.findOne(id, accessToken);

    // Get all sessions associated with this course
    const { data: sessions, error } = await this.supabaseService
      .getClientWithAuth(accessToken)
      .from('session_courses')
      .select(
        `
        session:sessions (
          session_id,
          session_name,
          start_date,
          end_date,
          enrollment_deadline,
          session_status
        ),
        status,
        adjusted_capacity
      `,
      )
      .eq('course_id', id);

    if (error) {
      throw new InternalServerErrorException(
        `Failed to fetch affiliated sessions: ${error.message}`,
      );
    }

    if (!sessions || sessions.length === 0) {
      throw new NotFoundException(`No sessions found for course with ID ${id}`);
    }

    // Extract and format the session data
    return sessions.map((sc) => ({
      ...sc.session,
      course_status: sc.status,
      adjusted_capacity: sc.adjusted_capacity,
    }));
  }

  async getEnrolledStudents(
    id: string,
    accessToken: string,
  ): Promise<EnrolledStudent[]> {
    // First check if course exists
    await this.findOne(id, accessToken);

    // Get all students enrolled in this course with approved, active, or completed status
    const { data: enrollments, error } = await this.supabaseService
      .getClientWithAuth(accessToken)
      .from('enrollments')
      .select(
        `
        student:students (
          student_id,
          reg_number,
          first_name,
          last_name,
          email,
          profile_picture,
          program:programs (
            program_id,
            program_name,
            program_type
          )
        ),
        session:sessions (
          session_id,
          session_name
        ),
        enrollment_status,
        special_request,
        rejection_reason,
        created_at
      `,
      )
      .eq('course_id', id)
      .in('enrollment_status', ['APPROVED', 'ACTIVE', 'COMPLETED'])
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException(
        `Failed to fetch enrolled students: ${error.message}`,
      );
    }

    if (!enrollments || enrollments.length === 0) {
      throw new NotFoundException(
        `No enrolled students found for course with ID ${id}`,
      );
    }

    // Format the response to include both student and enrollment information
    return (enrollments as unknown as SupabaseEnrollment[]).map(
      (enrollment) => ({
        student: {
          id: enrollment.student.student_id,
          reg_number: enrollment.student.reg_number,
          first_name: enrollment.student.first_name,
          last_name: enrollment.student.last_name,
          email: enrollment.student.email,
          profile_picture: enrollment.student.profile_picture,
          program: enrollment.student.program,
        },
        session: {
          session_id: enrollment.session.session_id,
          session_name: enrollment.session.session_name,
        },
        enrollment: {
          status: enrollment.enrollment_status,
          special_request: enrollment.special_request,
          rejection_reason: enrollment.rejection_reason,
          enrolled_at: enrollment.created_at,
        },
      }),
    );
  }
}
