import { PersonioClient } from '../api/personio-client.js';
import { isForbiddenError, accessDeniedResult } from '../utils/scope-hints.js';

export class AnalyticsHandlers {
  constructor(private personioClient: PersonioClient) {}

  async handleGetTeamAvailability(args: any) {
    const today = new Date().toISOString().split('T')[0];

    // This tool reads across three access areas, so a 403 is ambiguous on its
    // own — name all three in the hint instead of a bare "access denied".
    const fetched = await Promise.all([
      this.personioClient.getAttendances({
        start_date: today,
        end_date: today,
      }),
      this.personioClient.getAbsences({
        start_date: today,
        end_date: today,
      }),
      this.personioClient.getEmployees(),
    ]).catch((error) => {
      if (isForbiddenError(error)) {
        return accessDeniedResult('get team availability', error, ['attendances', 'absences', 'employees']);
      }
      throw error;
    });
    if ('isError' in fetched) return fetched;
    const [attendanceResponse, absenceResponse, employeesResponse] = fetched;

    const attendances = attendanceResponse.data.map(att => 
      this.personioClient.formatAttendanceData(att)
    );
    
    const absences = absenceResponse.data.map(abs => 
      this.personioClient.formatAbsenceData(abs)
    );
    
    let employees = employeesResponse.data.map(emp => 
      this.personioClient.formatEmployeeData(emp)
    );

    // Filter by department if specified
    if (args?.department) {
      employees = employees.filter(emp => 
        emp.department?.toLowerCase().includes(args.department?.toLowerCase() || '')
      );
    }

    // Build availability status for each employee
    const availability = employees.map(emp => {
      const empAttendance = attendances.find(att => att.employee_id === emp.id);
      const empAbsence = absences.find(abs => abs.employee_id === emp.id);
      
      let status = 'unknown';
      if (empAbsence) {
        status = 'on_leave';
      } else if (empAttendance) {
        status = empAttendance.end_time ? 'checked_out' : 'checked_in';
      } else {
        status = 'not_checked_in';
      }

      return {
        ...emp,
        status,
        attendance: empAttendance || null,
        absence: empAbsence || null,
      };
    });

    const summary = {
      total_employees: availability.length,
      checked_in: availability.filter(a => a.status === 'checked_in').length,
      checked_out: availability.filter(a => a.status === 'checked_out').length,
      on_leave: availability.filter(a => a.status === 'on_leave').length,
      not_checked_in: availability.filter(a => a.status === 'not_checked_in').length,
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            date: today,
            department_filter: args?.department,
            summary,
            team_availability: availability,
          }, null, 2),
        },
      ],
    };
  }
}
