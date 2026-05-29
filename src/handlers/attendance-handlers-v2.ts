import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { PersonioClient } from '../api/personio-client.js';
import { applyOffsetLimit, paginateStyleA } from '../utils/pagination.js';

// Advertised bounds for get_attendance_periods_v2 (mirrors inputSchema).
const ATTENDANCE_PERIODS_V2_BOUNDS = { defaultLimit: 200, maxLimit: 200 };
// generate_v1_v2_compatibility_report `limit` (mirrors inputSchema, default 50).
const COMPATIBILITY_REPORT_BOUNDS = { defaultLimit: 50, maxLimit: 200 };

export class AttendanceHandlersV2 {
  constructor(private personioClient: PersonioClient) {}

  async handleGetAttendancePeriodsV2(args: any) {
    try {
      const response = await this.personioClient.getAttendancePeriodsV2({
        person_id: args?.person_id,
        start_date_time: args?.start_date_time,
        end_date_time: args?.end_date_time,
        limit: args?.limit,
        offset: args?.offset,
      });

      const allFormatted = Array.isArray(response.data)
        ? response.data.map(att => this.personioClient.formatAttendanceDataV2(att))
        : [];

      // Forwarded offset/limit are honored server-side; only defensively clamp
      // `limit` here, never re-apply `offset`.
      const { items: formattedAttendances, offset, limit, total } = paginateStyleA(
        allFormatted,
        { offset: args?.offset, limit: args?.limit },
        ATTENDANCE_PERIODS_V2_BOUNDS,
        { mode: 'server', total: response.meta?.pagination?.total_count ?? allFormatted.length }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              api_version: 'v2',
              attendance_periods: formattedAttendances,
              count: formattedAttendances.length,
              total,
              offset,
              limit,
              pagination: response.meta?.pagination,
              filters: {
                person_id: args?.person_id,
                start_date_time: args?.start_date_time,
                end_date_time: args?.end_date_time,
              },
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('V2 Attendance API access denied')) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'V2 API Access Denied',
                message: 'Unable to access v2 attendance periods endpoint. This may be due to insufficient API scopes.',
                details: error.message,
                suggestion: 'Verify that your Personio API credentials have the correct scopes for v2 attendance endpoints. The required scope may be different from "attendances:read".',
                fallback: 'Consider using the v1 attendance endpoints (get_attendance_records) as an alternative.',
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
      throw new McpError(ErrorCode.InternalError, `Failed to get attendance periods v2: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async handleGetAttendancePeriodV2(args: any) {
    if (!args || !args.id) {
      throw new McpError(ErrorCode.InvalidParams, 'id is required');
    }

    try {
      const response = await this.personioClient.getAttendancePeriodV2(args.id);
      const formattedAttendance = this.personioClient.formatAttendanceDataV2(response.data);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              api_version: 'v2',
              attendance_period: formattedAttendance,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('V2 Attendance API access denied')) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'V2 API Access Denied',
                message: 'Unable to access v2 attendance period endpoint.',
                details: error.message,
                suggestion: 'Verify API scopes and consider using v1 endpoints as alternative.',
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
      throw new McpError(ErrorCode.InternalError, `Failed to get attendance period v2: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async handleCreateAttendancePeriodV2(args: any) {
    if (!args || typeof args.person_id !== 'number' || !args.start_date_time) {
      throw new McpError(ErrorCode.InvalidParams, 'person_id and start_date_time are required');
    }

    // Validate the datetime format
    if (!this.isValidISO8601DateTime(args.start_date_time)) {
      throw new McpError(ErrorCode.InvalidParams, 'start_date_time must be in ISO 8601 format (e.g., 2024-01-01T09:00:00)');
    }

    if (args.end_date_time && !this.isValidISO8601DateTime(args.end_date_time)) {
      throw new McpError(ErrorCode.InvalidParams, 'end_date_time must be in ISO 8601 format (e.g., 2024-01-01T17:00:00)');
    }

    try {
      // Map tool input type values to API type values
      const typeMap: Record<string, 'WORK' | 'BREAK'> = {
        'AttendancePeriod': 'WORK',
        'Break': 'BREAK',
        'WORK': 'WORK',
        'BREAK': 'BREAK',
      };
      const apiType = typeMap[args.type] || 'WORK';

      const response = await this.personioClient.createAttendancePeriodV2({
        person: { id: String(args.person_id) },
        type: apiType,
        start: {
          date_time: args.start_date_time,
        },
        end: args.end_date_time ? {
          date_time: args.end_date_time,
        } : undefined,
        comment: args.comment,
      });

      // V2 create returns { id, affected_periods: [...] }
      const createdPeriod = response.affected_periods?.find(p => p.id === response.id);
      const formattedAttendance = createdPeriod
        ? this.personioClient.formatAttendanceDataV2(createdPeriod)
        : { id: response.id };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              api_version: 'v2',
              attendance_period: formattedAttendance,
              message: 'Attendance period created successfully using v2 API',
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('V2 Attendance API access denied')) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'V2 API Access Denied',
                message: 'Unable to create attendance period using v2 endpoint.',
                details: error.message,
                suggestion: 'Verify API scopes include write permissions for v2 attendance endpoints.',
                fallback: 'Consider using the v1 attendance creation endpoint as an alternative.',
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
      throw new McpError(ErrorCode.InternalError, `Failed to create attendance period v2: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async handleUpdateAttendancePeriodV2(args: any) {
    if (!args || !args.id) {
      throw new McpError(ErrorCode.InvalidParams, 'id is required');
    }

    // Validate datetime formats if provided
    if (args.start_date_time && !this.isValidISO8601DateTime(args.start_date_time)) {
      throw new McpError(ErrorCode.InvalidParams, 'start_date_time must be in ISO 8601 format');
    }

    if (args.end_date_time && !this.isValidISO8601DateTime(args.end_date_time)) {
      throw new McpError(ErrorCode.InvalidParams, 'end_date_time must be in ISO 8601 format');
    }

    try {
      const updateData: any = {};

      if (args.person_id) updateData.person = { id: String(args.person_id) };
      if (args.type) {
        const typeMap: Record<string, 'WORK' | 'BREAK'> = {
          'AttendancePeriod': 'WORK',
          'Break': 'BREAK',
          'WORK': 'WORK',
          'BREAK': 'BREAK',
        };
        updateData.type = typeMap[args.type] || args.type;
      }
      if (args.start_date_time) {
        updateData.start = {
          date_time: args.start_date_time,
        };
      }
      if (args.end_date_time) {
        updateData.end = {
          date_time: args.end_date_time,
        };
      }
      if (args.comment !== undefined) updateData.comment = args.comment;

      const response = await this.personioClient.updateAttendancePeriodV2(args.id, updateData);
      const formattedAttendance = this.personioClient.formatAttendanceDataV2(response.data);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              api_version: 'v2',
              attendance_period: formattedAttendance,
              message: 'Attendance period updated successfully using v2 API',
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('V2 Attendance API access denied')) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'V2 API Access Denied',
                message: 'Unable to update attendance period using v2 endpoint.',
                details: error.message,
                suggestion: 'Verify API scopes include write permissions for v2 attendance endpoints.',
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
      throw new McpError(ErrorCode.InternalError, `Failed to update attendance period v2: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async handleDeleteAttendancePeriodV2(args: any) {
    if (!args || !args.id) {
      throw new McpError(ErrorCode.InvalidParams, 'id is required');
    }

    try {
      await this.personioClient.deleteAttendancePeriodV2(args.id);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              api_version: 'v2',
              message: `Attendance period ${args.id} deleted successfully using v2 API`,
              deleted_id: args.id,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('V2 Attendance API access denied')) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'V2 API Access Denied',
                message: 'Unable to delete attendance period using v2 endpoint.',
                details: error.message,
                suggestion: 'Verify API scopes include write permissions for v2 attendance endpoints.',
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
      throw new McpError(ErrorCode.InternalError, `Failed to delete attendance period v2: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Generate a compatibility report comparing v1 and v2 data
  async handleGenerateV1V2CompatibilityReport(args: any) {
    if (!args || (!args.person_id && !args.start_date)) {
      throw new McpError(ErrorCode.InvalidParams, 'Either person_id or start_date is required');
    }

    try {
      // Try to get data from both v1 and v2 APIs for comparison
      const v1Promise = this.personioClient.getAttendances({
        start_date: args.start_date,
        end_date: args.end_date || args.start_date,
        employees: args.person_id ? [args.person_id] : undefined,
        limit: args.limit || 50,
      });

      let v2Data = null;
      let v2Error = null;

      try {
        const v2Response = await this.personioClient.getAttendancePeriodsV2({
          person_id: args.person_id,
          start_date_time: args.start_date ? `${args.start_date}T00:00:00` : undefined,
          end_date_time: args.end_date ? `${args.end_date}T23:59:59` : undefined,
          limit: args.limit || 50,
        });
        v2Data = v2Response.data;
      } catch (error) {
        v2Error = error instanceof Error ? error.message : 'Unknown error';
      }

      const v1Response = await v1Promise;

      // Enforce `limit` client-side on both sides (the v1/v2 endpoints do not
      // reliably cap server-side), so the report compares at most `limit` records.
      const { items: v1Data, limit } = applyOffsetLimit(
        v1Response.data,
        { limit: args.limit },
        COMPATIBILITY_REPORT_BOUNDS
      );
      const v2List = Array.isArray(v2Data) ? v2Data : [];
      const { items: v2Sliced } = applyOffsetLimit(
        v2List,
        { limit: args.limit },
        COMPATIBILITY_REPORT_BOUNDS
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              compatibility_report: {
                compared_limit: limit,
                v1_api: {
                  available: true,
                  records_count: v1Data.length,
                  sample_record: v1Data[0] ? this.personioClient.formatAttendanceData(v1Data[0]) : null,
                },
                v2_api: {
                  available: v2Error === null,
                  error: v2Error,
                  records_count: v2Sliced.length,
                  sample_record: v2Sliced[0] ? this.personioClient.formatAttendanceDataV2(v2Sliced[0]) : null,
                },
                compatibility_notes: [
                  'V1 API uses date + separate time fields, V2 API uses ISO 8601 datetime format',
                  'V1 API has employee_id, V2 API has person_id',
                  'V1 API has break_minutes field, V2 API handles breaks as separate periods',
                  'V2 API includes timezone information which V1 does not',
                  'V2 API supports different attendance period types (AttendancePeriod, Break)',
                ],
                migration_recommendations: v2Error === null ? [
                  'V2 API is accessible - consider migrating for enhanced features',
                  'Test v2 endpoints thoroughly before switching production usage',
                  'Use conversion helpers provided in PersonioClient for data transformation',
                ] : [
                  'V2 API is not accessible - verify API scopes and credentials',
                  'Continue using V1 API until V2 access is resolved',
                  'Contact Personio support for V2 API access requirements',
                ],
              },
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to generate compatibility report: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Helper method to validate ISO 8601 datetime format
  private isValidISO8601DateTime(datetime: string): boolean {
    const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
    return iso8601Regex.test(datetime) && !isNaN(Date.parse(datetime));
  }
}