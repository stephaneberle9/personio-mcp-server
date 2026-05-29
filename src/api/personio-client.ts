import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { PersonioAuth, PersonioAuthConfig } from '../auth/personio-auth.js';

export interface PersonioClientConfig extends PersonioAuthConfig {
  baseUrl?: string;
  /**
   * How long the tenant attribute schema is cached, in milliseconds. Defaults to
   * `PERSONIO_ATTRIBUTE_CACHE_TTL_SECONDS` (or 1 hour). `0` disables caching
   * (the schema is refetched on every use). See `getAttributeSchema`.
   */
  attributeCacheTtlMs?: number;
}

/** Default attribute-schema cache TTL when none is configured: 1 hour. */
const DEFAULT_ATTRIBUTE_CACHE_TTL_MS = 3_600_000;

/**
 * Resolve the attribute-schema cache TTL (ms) from
 * `PERSONIO_ATTRIBUTE_CACHE_TTL_SECONDS`. A long-running deployment (e.g. a web
 * connector) must periodically re-read the schema so renamed labels and newly
 * added custom fields are eventually picked up — hence a finite default rather
 * than caching for the whole process lifetime. `0` disables caching entirely;
 * an empty/invalid value falls back to the default.
 */
function defaultAttributeCacheTtlMs(): number {
  const raw = process.env.PERSONIO_ATTRIBUTE_CACHE_TTL_SECONDS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_ATTRIBUTE_CACHE_TTL_MS;

  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    console.error(
      `Invalid PERSONIO_ATTRIBUTE_CACHE_TTL_SECONDS (expected a non-negative number of seconds): ${raw}`
    );
    return DEFAULT_ATTRIBUTE_CACHE_TTL_MS;
  }
  return seconds * 1000;
}

/**
 * Default mapping from Personio dynamic attribute IDs (`dynamic_<id>`) to
 * human-readable field names. Personio exposes custom fields under opaque
 * `dynamic_<id>` keys; this map lets the server surface them under a friendly
 * name instead. Tenant-specific IDs differ between Personio accounts, so this
 * is only a small set of sensible defaults.
 *
 * In most cases this can stay empty: when a `dynamic_<id>` field is *not* listed
 * here, the server derives a readable key from the field's own Personio label
 * (e.g. `"Kostenstelle kurz"` → `kostenstelle_kurz`). This map is only needed to
 * *override* the cases where the label is missing or a poor fit.
 *
 * Extend or override it at runtime — without a code change — via the
 * `PERSONIO_DYNAMIC_FIELD_MAP` environment variable, which must contain a JSON
 * object of `{ "dynamic_<id>": "readable_name" }`. Entries from the env var are
 * merged on top of these defaults (env values win on key collisions).
 *
 * Use the `print-attributes` helper script to discover which `dynamic_<id>`
 * keys a given tenant actually exposes, and their labels.
 */
const DEFAULT_DYNAMIC_FIELD_MAP: Record<string, string> = {
  dynamic_14285869: 'shoe_size',
};

function loadDynamicFieldMap(): Record<string, string> {
  const raw = process.env.PERSONIO_DYNAMIC_FIELD_MAP;
  if (!raw) {
    return { ...DEFAULT_DYNAMIC_FIELD_MAP };
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected a JSON object');
    }
    return { ...DEFAULT_DYNAMIC_FIELD_MAP, ...(parsed as Record<string, string>) };
  } catch (error) {
    // Log to stderr (stdout is reserved for the MCP protocol) and fall back to
    // the defaults rather than crashing the server on a malformed env var.
    console.error(
      `Invalid PERSONIO_DYNAMIC_FIELD_MAP (expected a JSON object of dynamic_<id> -> name): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return { ...DEFAULT_DYNAMIC_FIELD_MAP };
  }
}

/**
 * Active dynamic-field mapping, resolved once at module load from the defaults
 * plus any `PERSONIO_DYNAMIC_FIELD_MAP` override.
 */
export const DYNAMIC_FIELD_MAP: Record<string, string> = loadDynamicFieldMap();

/**
 * Turn a human-readable Personio attribute label into a JSON/identifier-friendly
 * key, e.g. `"Kostenstelle kurz"` → `kostenstelle_kurz`, `"Mobil (itemis)"` →
 * `mobil_itemis`. German umlauts are transliterated (ä→ae, ö→oe, ü→ue, ß→ss)
 * before remaining diacritics are stripped, so the result stays ASCII. Returns
 * an empty string for a missing/blank label, signalling the caller to fall back
 * to the raw attribute key.
 */
export function slugifyLabel(label: unknown): string {
  if (typeof label !== 'string') return '';
  return label
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'ae')
    .replace(/Ö/g, 'oe')
    .replace(/Ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD') // decompose remaining accents (é → e + combining mark)
    .replace(/[̀-ͯ]/g, '') // strip the combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_') // any run of non-alphanumerics → single underscore
    .replace(/^_+|_+$/g, ''); // trim leading/trailing underscores
}

/**
 * Resolve the output key a Personio attribute should be surfaced under, applying
 * (in order of precedence):
 *   1. an explicit `DYNAMIC_FIELD_MAP` / `PERSONIO_DYNAMIC_FIELD_MAP` entry,
 *   2. for opaque `dynamic_<id>` custom fields, the slugified API label, and
 *   3. the raw attribute key as a last resort.
 *
 * Label derivation is intentionally scoped to `dynamic_<id>` keys so that
 * standard attributes (`cost_centers`, `created_at`, …) keep their expected,
 * stable keys. Note this only computes the *desired* key — collision handling
 * (two labels slugging to the same name, or a slug clashing with a friendly
 * alias) lives in `formatEmployeeData`, which can see what is already taken.
 */
export function resolveAttributeKey(key: string, label?: unknown): string {
  const mapped = DYNAMIC_FIELD_MAP[key];
  if (mapped) return mapped;

  if (key.startsWith('dynamic_')) {
    const slug = slugifyLabel(label);
    if (slug) return slug;
  }

  return key;
}

/**
 * Output keys that `formatEmployeeData` always derives up front (its friendly
 * aliases), reserved so a dynamic field whose label happens to slugify to one of
 * them falls back to its raw key instead of clobbering the alias — exactly the
 * collision behavior `formatEmployeeData` itself applies.
 */
const RESERVED_OUTPUT_KEYS = [
  'id', 'name', 'email', 'position', 'department', 'office', 'status',
  'hire_date', 'weekly_hours',
];

/**
 * Reverse of the friendly aliases `formatEmployeeData` derives under a *different*
 * name than the underlying raw attribute key(s). Lets callers request the
 * friendly name (`name`, `weekly_hours`) and have it translated back to the raw
 * Personio key(s) the API filter expects. Aliases that keep their raw key
 * (`email`, `position`, …) need no entry — they pass through unchanged.
 */
const FRIENDLY_ALIAS_REVERSE: Record<string, string[]> = {
  name: ['first_name', 'last_name'],
  weekly_hours: ['weekly_working_hours'],
};

/** JS type of an attribute value, for human-/agent-readable schema output. */
function describeAttributeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** A single attribute as exposed to callers: how to request it vs. how it returns. */
export interface AttributeInfo {
  /** Raw Personio key — use this in the `attributes` request filter. */
  key: string;
  /** Key the value is surfaced under in get_employee / list_employees output. */
  output_key: string;
  /** Where output_key came from: explicit map, derived label, or the raw key. */
  source: 'map' | 'label' | 'key';
  /** Human-readable Personio label, if any. */
  label: string | null;
  /** JS type of the attribute value (string, number, array, object, null, …). */
  type: string;
}

/**
 * Build the attribute schema for an employee's raw `attributes` object: for each
 * key, the output name it is surfaced under (mirroring `formatEmployeeData`'s
 * precedence and collision handling) plus its label and value type. Powers both
 * the discovery tool and the request-side reverse translation.
 */
export function buildAttributeSchema(
  attrs: Record<string, { label?: unknown; value?: unknown }>
): AttributeInfo[] {
  const taken = new Set<string>(RESERVED_OUTPUT_KEYS);
  const schema: AttributeInfo[] = [];

  for (const key of Object.keys(attrs)) {
    const attr = attrs[key] ?? {};
    const mapped = DYNAMIC_FIELD_MAP[key];
    let outputKey = resolveAttributeKey(key, attr.label);

    // Collision with an alias or an earlier field: fall back to the raw key,
    // matching formatEmployeeData so the reported output_key is accurate.
    if (outputKey !== key && taken.has(outputKey)) outputKey = key;
    taken.add(outputKey);

    const source: AttributeInfo['source'] = mapped
      ? 'map'
      : outputKey !== key
        ? 'label'
        : 'key';

    schema.push({
      key,
      output_key: outputKey,
      source,
      label: typeof attr.label === 'string' && attr.label.trim() ? attr.label : null,
      type: describeAttributeType(attr.value),
    });
  }

  return schema;
}

/**
 * Build a reverse index `output/friendly name -> raw Personio key(s)` from an
 * attribute schema. Used to translate caller-supplied attribute names (resolved
 * output names *or* raw keys) back to the raw keys the API filter expects.
 */
export function buildReverseAttributeIndex(schema: AttributeInfo[]): Map<string, string[]> {
  const reverse = new Map<string, string[]>(Object.entries(FRIENDLY_ALIAS_REVERSE));
  for (const { key, output_key } of schema) {
    // A raw key always maps to itself; the resolved name maps back to the raw
    // key. Friendly aliases above take precedence and are never overwritten.
    if (!reverse.has(key)) reverse.set(key, [key]);
    if (output_key !== key && !reverse.has(output_key)) reverse.set(output_key, [key]);
  }
  return reverse;
}

/**
 * Shape of a formatted employee. The named fields are the friendly aliases the
 * server always derives; the index signature allows every additional attribute
 * the API scope returns (including mapped `dynamic_<id>` fields) to pass through
 * under its own key without falling back to `any`.
 */
export interface FormattedEmployee {
  id?: number;
  name?: string;
  email?: string;
  position?: string;
  department?: string | null;
  office?: string | null;
  status?: string;
  hire_date?: string;
  weekly_hours?: string;
  [key: string]: unknown;
}

export interface PersonioApiResponse<T = any> {
  success: boolean;
  data: T;
  metadata?: {
    total_elements?: number;
    current_page?: number;
    total_pages?: number;
  };
}

// V2 API Response interface (different structure from v1)
export interface PersonioApiResponseV2<T = any> {
  data: T;
  meta?: {
    pagination?: {
      current_page: number;
      per_page: number;
      total_pages: number;
      total_count: number;
    };
  };
}

export interface Employee {
  type: string;
  attributes: {
    id: { label: string; value: number };
    email: { label: string; value: string };
    first_name: { label: string; value: string };
    last_name: { label: string; value: string };
    status: { label: string; value: string };
    position: { label: string; value: string };
    department: {
      label: string;
      value: {
        type: string;
        attributes: {
          id: number;
          name: string;
        };
      } | string | null;
    };
    office: {
      label: string;
      value: {
        type: string;
        attributes: {
          id: number;
          name: string;
        };
      } | null;
    };
    hire_date: { label: string; value: string };
    weekly_working_hours: { label: string; value: string };
    [key: string]: any;
  };
}

export interface AttendancePeriod {
  type: string;
  attributes: {
    id: number;
    employee: number;
    date: string;
    start_time: string;
    end_time: string;
    break: number;
    comment: string;
    is_holiday: boolean;
    is_on_time_off: boolean;
    updated_at: string;
  };
}

// V2 Attendance Period interface (based on v2 API structure)
export interface AttendancePeriodV2 {
  id: string;
  type: 'WORK' | 'BREAK';
  person: {
    id: string;
  };
  approval?: {
    status: string;
  };
  start: {
    date_time: string;
  };
  end?: {
    date_time: string;
  };
  attribution_date?: string;
  comment?: string;
  project?: any;
  is_auto_generated?: boolean;
  is_holiday?: boolean;
  is_on_time_off?: boolean;
  created_at: string;
  updated_at: string;
}

// V2 Attendance Create Response
export interface AttendancePeriodV2CreateResponse {
  id: string;
  affected_periods: AttendancePeriodV2[];
}

export interface AttendancePeriodV2Request {
  person: { id: string };
  type: 'WORK' | 'BREAK';
  start: {
    date_time: string;
  };
  end?: {
    date_time: string;
  };
  comment?: string;
}

export interface AbsencePeriod {
  type: string;
  attributes: {
    id: number;
    employee: number;
    time_off_type: {
      type: string;
      attributes: {
        id: number;
        name: string;
        category: string;
      };
    };
    status: string;
    comment: string;
    start_date: string;
    end_date: string;
    days_count: number;
    half_day_start: boolean;
    half_day_end: boolean;
    created_at: string;
    updated_at: string;
  };
}

export interface AbsenceBalance {
  name: string;
  balance: number;
  used: number;
  available: number;
  category: string;
}

export interface DocumentCategory {
  type: string;
  attributes: {
    id: number;
    name: string;
  };
}

// V1 Document interface (legacy, kept for reference)
export interface Document {
  type: string;
  attributes: {
    id: number;
    title: string;
    category: {
      type: string;
      attributes: {
        id: number;
        name: string;
      };
    };
    employee: number;
    created_at: string;
    updated_at: string;
    file_name: string;
    file_size: number;
    file_type: string;
  };
}

// V2 Document interface (Document Management API)
export interface DocumentV2 {
  id: string;
  name: string;
  date: string;
  comment: string | null;
  category: { id: string };
  owner: { id: string };
  document_type: string;
  size: number;
  created_at: string;
  virus_scan?: { status: string };
  esignature?: { status: string };
}

// V2 Recruiting API Response interface (uses _data/_meta with underscore prefix)
export interface PersonioRecruitingResponse<T = any> {
  _data: T;
  _meta?: {
    links?: {
      next?: { href: string };
    };
  };
}

// Recruiting interfaces (matching actual V2 Recruiting API response shapes)
export interface RecruitingApplication {
  id: string;
  application_date: string;
  candidate: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    gender?: string;
  };
  job: {
    id: string;
    name: string;
    department?: { id: string; name: string };
    category?: any;
  };
  current_stage: {
    id: string | null;
    kind: string;
    name: string | null;
    type: string;
  };
  channel?: { id: string; name: string };
  hiring_team?: any;
  is_anonymized: boolean;
  created_at: { 'date-time': string; timezone: string };
  updated_at: { 'date-time': string; timezone: string };
  [key: string]: any;
}

export interface RecruitingCandidate {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  gender?: string;
  phone?: string;
  location?: string;
  birthday?: string;
  linkedin_profile?: string;
  available_from?: string;
  applications?: { id: string; application_date: string }[];
  created_at: string;
  updated_at: string;
  [key: string]: any;
}

export interface RecruitingJob {
  id: string;
  name: string;
  department?: { id: string; name: string };
  category?: any;
  hiring_team?: any[];
  company?: { id: string };
  created_at: { 'date-time': string; timezone: string };
  updated_at: { 'date-time': string; timezone: string };
  [key: string]: any;
}

export interface RecruitingStageTransition {
  entered_at: { 'date-time': string; timezone: string };
  stage: {
    id: string | null;
    kind: string;
    name: string | null;
    type: string;
  };
  [key: string]: any;
}

export interface RecruitingCategory {
  id: string;
  name: string;
  stages?: any[];
  company?: { id: string };
  [key: string]: any;
}

export interface UploadDocumentParams {
  title: string;
  employee_id: number;
  category_id: number;
  file: Buffer | string;
  file_name: string;
}

export class PersonioClient {
  private auth: PersonioAuth;
  private axiosInstance: AxiosInstance;
  private baseUrl: string;

  // Tenant attribute schema, reused for both attribute discovery and
  // request-side name translation. Cached as a promise (so concurrent callers
  // share one in-flight fetch) together with its fetch time, so it can expire
  // and be refreshed — see attributeCacheTtlMs / getAttributeSchema.
  private attributeSchemaCache: { promise: Promise<AttributeInfo[]>; fetchedAt: number } | null = null;
  private readonly attributeCacheTtlMs: number;

  constructor(config: PersonioClientConfig) {
    this.baseUrl = config.baseUrl || 'https://api.personio.de';
    this.attributeCacheTtlMs = config.attributeCacheTtlMs ?? defaultAttributeCacheTtlMs();
    this.auth = new PersonioAuth(config);
    
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    // Add request interceptor to include auth header
    this.axiosInstance.interceptors.request.use(async (config) => {
      const authHeader = await this.auth.getAuthHeader();
      Object.assign(config.headers, authHeader);
      return config;
    });

    // Add response interceptor for error handling
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        if (axios.isAxiosError(error)) {
          const message = error.response?.data?.error?.message || error.message;
          throw new Error(`Personio API error: ${message}`);
        }
        throw error;
      }
    );
  }

  // Employee endpoints
  async getEmployees(params?: {
    limit?: number;
    offset?: number;
    attributes?: string[];
    office?: string;
  }): Promise<PersonioApiResponse<Employee[]>> {
    const queryParams = new URLSearchParams();

    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.offset) queryParams.append('offset', params.offset.toString());
    if (params?.attributes) {
      params.attributes.forEach(attr => queryParams.append('attributes[]', attr));
    }

    // console.log(`Fetching employees with attributes ${queryParams.toString()}`);

    const response = await this.axiosInstance.get(`/v1/company/employees?${queryParams}`);

    // Client-side filtering by office if specified
    if (params?.office && response.data.data) {
      const filteredData = response.data.data.filter((employee: Employee) => {
        const officeName = employee.attributes.office?.value?.attributes?.name;
        return officeName?.toLowerCase().includes(params.office!.toLowerCase());
      });

      return {
        ...response.data,
        data: filteredData,
      };
    }

    return response.data;
  }

  async getEmployee(employeeId: number, attributes?: string[]): Promise<PersonioApiResponse<Employee>> {
    const queryParams = new URLSearchParams();
    if (attributes) {
      attributes.forEach(attr => queryParams.append('attributes[]', attr));
    }

    // console.log(`Fetching employee with ID ${employeeId} and attributes ${attributes?.join(', ') || 'all'}`);

    const response = await this.axiosInstance.get(`/v1/company/employees/${employeeId}?${queryParams}`);
    return response.data;
  }

  /**
   * Tenant attribute schema (cached): for each attribute the credential's scope
   * exposes, its raw key, the output name it is surfaced under, its source, label
   * and value type. Sampled from one employee (labels are tenant-global); pass
   * an `employeeId` to sample a specific one, otherwise the first listed employee
   * is used.
   *
   * The result is memoized for `attributeCacheTtlMs`, then refetched on the next
   * use so renamed labels and newly added custom fields are picked up by a
   * long-running server. A TTL of `0` disables caching. Use
   * `invalidateAttributeSchema` to force a refresh sooner.
   */
  async getAttributeSchema(employeeId?: number): Promise<AttributeInfo[]> {
    const cached = this.attributeSchemaCache;
    if (
      cached &&
      this.attributeCacheTtlMs > 0 &&
      Date.now() - cached.fetchedAt < this.attributeCacheTtlMs
    ) {
      return cached.promise;
    }

    const promise = (async () => {
      let attrs: Record<string, { label?: unknown; value?: unknown }> | undefined;
      if (employeeId !== undefined) {
        attrs = (await this.getEmployee(employeeId)).data?.attributes;
      } else {
        attrs = (await this.getEmployees({ limit: 1 })).data?.[0]?.attributes;
      }
      if (!attrs) {
        throw new Error('Could not load attribute schema: no employee attributes returned');
      }
      return buildAttributeSchema(attrs);
    })();

    const entry = { promise, fetchedAt: Date.now() };
    this.attributeSchemaCache = entry;
    // Don't leave a rejected promise cached — let the next caller retry.
    promise.catch(() => {
      if (this.attributeSchemaCache === entry) this.attributeSchemaCache = null;
    });
    return promise;
  }

  /** Drop the cached attribute schema so the next access refetches it. */
  invalidateAttributeSchema(): void {
    this.attributeSchemaCache = null;
  }

  /**
   * Translate caller-supplied attribute names — which may be resolved output
   * names (`name`, `weekly_hours`, `kostenstelle_kurz`, `shoe_size`) or raw
   * Personio keys — into the raw keys the API `attributes` filter expects.
   * Unknown names pass through unchanged (assumed already raw). Loads the tenant
   * schema (cached) only when given a non-empty list.
   */
  async resolveRequestedAttributes(names?: string[]): Promise<string[] | undefined> {
    if (!names || names.length === 0) return names;

    const reverse = buildReverseAttributeIndex(await this.getAttributeSchema());
    const resolved: string[] = [];
    for (const name of names) {
      const rawKeys = reverse.get(name);
      if (rawKeys) resolved.push(...rawKeys);
      else resolved.push(name); // already a raw key, or unknown → pass through
    }
    return [...new Set(resolved)];
  }

  // Attendance endpoints
  async getAttendances(params?: {
    start_date?: string;
    end_date?: string;
    employees?: number[];
    limit?: number;
    offset?: number;
  }): Promise<PersonioApiResponse<AttendancePeriod[]>> {
    const queryParams = new URLSearchParams();
    
    if (params?.start_date) queryParams.append('start_date', params.start_date);
    if (params?.end_date) queryParams.append('end_date', params.end_date);
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.offset) queryParams.append('offset', params.offset.toString());
    if (params?.employees) {
      params.employees.forEach(emp => queryParams.append('employees[]', emp.toString()));
    }

    const response = await this.axiosInstance.get(`/v1/company/attendances?${queryParams}`);
    return response.data;
  }

  // Absence endpoints
  async getAbsences(params?: {
    start_date?: string;
    end_date?: string;
    employees?: number[];
    limit?: number;
    offset?: number;
  }): Promise<PersonioApiResponse<AbsencePeriod[]>> {
    const queryParams = new URLSearchParams();
    
    if (params?.start_date) queryParams.append('start_date', params.start_date);
    if (params?.end_date) queryParams.append('end_date', params.end_date);
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.offset) queryParams.append('offset', params.offset.toString());
    if (params?.employees) {
      params.employees.forEach(emp => queryParams.append('employees[]', emp.toString()));
    }

    const response = await this.axiosInstance.get(`/v1/company/time-offs?${queryParams}`);
    return response.data;
  }

  async getAbsenceBalance(employeeId: number): Promise<PersonioApiResponse<AbsenceBalance[]>> {
    const response = await this.axiosInstance.get(`/v1/company/employees/${employeeId}/absences/balance`);
    return response.data;
  }

  async getAbsenceTypes(): Promise<PersonioApiResponse<any[]>> {
    const response = await this.axiosInstance.get('/v1/company/time-off-types');
    return response.data;
  }

  // Document endpoints
  async getDocumentCategories(): Promise<PersonioApiResponse<DocumentCategory[]>> {
    const response = await this.axiosInstance.get('/v1/company/document-categories');
    return response.data;
  }

  async getEmployeeDocuments(employeeId: number, params?: {
    category_id?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ _data: DocumentV2[]; _meta?: any }> {
    const queryParams = new URLSearchParams();
    queryParams.append('owner_id', employeeId.toString());

    if (params?.category_id) queryParams.append('category_id', params.category_id.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.cursor) queryParams.append('cursor', params.cursor);

    const authHeader = await this.auth.getAuthHeader();
    const response = await axios.get(`${this.baseUrl}/v2/document-management/documents?${queryParams}`, {
      headers: { ...authHeader, Accept: 'application/json' },
      timeout: 30000,
    });
    const body = response.data;
    if (body._data !== undefined) return body;
    if (body.data !== undefined) return { _data: body.data, _meta: body._meta || body.meta };
    return { _data: body as any[], _meta: undefined };
  }

  // NOTE: V2 Document Management API has no upload endpoint.
  // This uses the V1 endpoint which may not be available on all Personio plans.
  async uploadDocument(params: UploadDocumentParams): Promise<PersonioApiResponse<Document>> {
    const formData = new FormData();
    formData.append('title', params.title);
    formData.append('employee_id', params.employee_id.toString());
    formData.append('category_id', params.category_id.toString());

    if (typeof params.file === 'string') {
      formData.append('file', params.file);
    } else {
      // Wrap in a Uint8Array view so the Blob part type is a concrete
      // ArrayBuffer-backed view (newer @types/node no longer accept a bare
      // Buffer, whose backing buffer may be a SharedArrayBuffer, as a BlobPart).
      const blob = new Blob([new Uint8Array(params.file)]);
      formData.append('file', blob, params.file_name);
    }

    const response = await this.axiosInstance.post('/v1/company/documents', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }

  async downloadDocument(documentId: string): Promise<Buffer> {
    const authHeader = await this.auth.getAuthHeader();
    const response = await axios.get(
      `${this.baseUrl}/v2/document-management/documents/${documentId}/download`,
      {
        headers: { ...authHeader },
        responseType: 'arraybuffer',
        timeout: 60000,
      }
    );
    return Buffer.from(response.data);
  }

  async deleteDocument(documentId: string): Promise<void> {
    const authHeader = await this.auth.getAuthHeader();
    await axios.delete(
      `${this.baseUrl}/v2/document-management/documents/${documentId}`,
      {
        headers: { ...authHeader },
        timeout: 30000,
      }
    );
    // V2 returns 204 No Content on success
  }

  // Approval workflow endpoints
  async createAttendanceWithApproval(params: {
    employee_id: number;
    date: string;
    start_time: string;
    end_time: string;
    break_minutes?: number;
    comment?: string;
    skip_approval?: boolean;
  }): Promise<PersonioApiResponse<AttendancePeriod>> {
    const response = await this.axiosInstance.post('/v1/company/attendances', {
      attendances: [
        {
          employee: params.employee_id,
          date: params.date,
          start_time: params.start_time,
          end_time: params.end_time,
          break: params.break_minutes || 0,
          comment: params.comment || '',
        },
      ],
      skip_approval: params.skip_approval ?? false,
    });
    return response.data;
  }

  async getPendingApprovals(params?: {
    type?: 'attendance' | 'absence' | 'document';
    employee_id?: number;
    limit?: number;
    offset?: number;
  }): Promise<PersonioApiResponse<any[]>> {
    const queryParams = new URLSearchParams();
    
    if (params?.type) queryParams.append('type', params.type);
    if (params?.employee_id) queryParams.append('employee_id', params.employee_id.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.offset) queryParams.append('offset', params.offset.toString());

    // Note: This endpoint might not exist in the current API, but it's a common pattern
    const response = await this.axiosInstance.get(`/v1/company/approvals?${queryParams}`);
    return response.data;
  }

  // Utility methods
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    try {
      await this.auth.getValidToken();
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Helper method to format employee data for display.
  // Surfaces every attribute the API scope returns: known fields get friendly
  // aliases, and any remaining attribute passes through under its own key
  // (with dynamic_<id> fields renamed via DYNAMIC_FIELD_MAP where configured).
  formatEmployeeData(employee: Employee): FormattedEmployee {
    const attrs = employee.attributes;

    // Extract department name from nested object or use string value
    let departmentName: string | null = null;
    if (attrs.department?.value) {
      if (typeof attrs.department.value === 'object' && attrs.department.value.attributes) {
        departmentName = attrs.department.value.attributes.name;
      } else if (typeof attrs.department.value === 'string') {
        departmentName = attrs.department.value;
      }
    }

    const employeeData: FormattedEmployee = {
      id: attrs.id?.value,
      name: `${attrs.first_name?.value || ''} ${attrs.last_name?.value || ''}`.trim(),
      email: attrs.email?.value,
      position: attrs.position?.value,
      department: departmentName,
      office: attrs.office?.value?.attributes?.name || null,
      status: attrs.status?.value,
      hire_date: attrs.hire_date?.value,
      weekly_hours: attrs.weekly_working_hours?.value,
    };

    // Pass through every other attribute the scope returned. Each key is
    // resolved to a readable output name (explicit map > slugified dynamic_<id>
    // label > raw key — see resolveAttributeKey). The `=== undefined` guard
    // preserves legitimate falsy values (0, false, "") instead of dropping
    // them, and never overwrites a friendly alias already set above.
    for (const key in attrs) {
      if (attrs[key]?.value === undefined) continue;

      let targetKey = resolveAttributeKey(key, attrs[key]?.label);

      // Collision: the resolved name is already taken (a friendly alias, or an
      // earlier attribute whose label slugified to the same name). Fall back to
      // the raw, guaranteed-unique key so the value is never silently dropped.
      if (targetKey !== key && employeeData[targetKey] !== undefined) {
        targetKey = key;
      }

      if (employeeData[targetKey] === undefined) {
        employeeData[targetKey] = attrs[key].value;
      }
    }

    return employeeData;
  }

  // Helper method to format attendance data
  formatAttendanceData(attendance: AttendancePeriod): any {
    const attrs = attendance.attributes;
    return {
      id: attrs.id,
      employee_id: attrs.employee,
      date: attrs.date,
      start_time: attrs.start_time,
      end_time: attrs.end_time,
      break_minutes: attrs.break,
      comment: attrs.comment,
      is_holiday: attrs.is_holiday,
      is_on_time_off: attrs.is_on_time_off,
      updated_at: attrs.updated_at,
    };
  }

  // Helper method to format absence data
  formatAbsenceData(absence: AbsencePeriod): any {
    const attrs = absence.attributes;
    return {
      id: attrs.id,
      employee_id: attrs.employee,
      type: attrs.time_off_type?.attributes?.name,
      category: attrs.time_off_type?.attributes?.category,
      status: attrs.status,
      start_date: attrs.start_date,
      end_date: attrs.end_date,
      days_count: attrs.days_count,
      half_day_start: attrs.half_day_start,
      half_day_end: attrs.half_day_end,
      comment: attrs.comment,
      created_at: attrs.created_at,
      updated_at: attrs.updated_at,
    };
  }

  // Helper method to format document data
  formatDocumentData(document: DocumentV2): any {
    return {
      id: document.id,
      name: document.name,
      date: document.date,
      comment: document.comment,
      category_id: document.category?.id,
      owner_id: document.owner?.id,
      document_type: document.document_type,
      size: document.size,
      created_at: document.created_at,
      virus_scan_status: document.virus_scan?.status,
    };
  }

  // Helper method to format document category data
  formatDocumentCategoryData(category: DocumentCategory): any {
    const attrs = category.attributes;
    return {
      id: attrs.id,
      name: attrs.name,
    };
  }

  // ====== V2 Attendance Period Methods ======

  // List attendance periods (v2)
  async getAttendancePeriodsV2(params?: {
    person_id?: number;
    start_date_time?: string;
    end_date_time?: string;
    limit?: number;
    offset?: number;
  }): Promise<PersonioApiResponseV2<AttendancePeriodV2[]>> {
    const queryParams = new URLSearchParams();

    if (params?.person_id) queryParams.append('person.id', params.person_id.toString());
    if (params?.start_date_time) queryParams.append('start.date_time.gte', params.start_date_time);
    if (params?.end_date_time) queryParams.append('end.date_time.lte', params.end_date_time);
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.offset) queryParams.append('offset', params.offset.toString());

    try {
      const response = await this.axiosInstance.get(`/v2/attendance-periods?${queryParams}`);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        throw new Error(`V2 Attendance API access denied. This may be due to insufficient scopes. Required scope may be different from 'attendances:read'. Error: ${error.response?.data?.error?.message || error.message}`);
      }
      throw error;
    }
  }

  // Get single attendance period by ID (v2)
  async getAttendancePeriodV2(id: string | number): Promise<PersonioApiResponseV2<AttendancePeriodV2>> {
    try {
      const response = await this.axiosInstance.get(`/v2/attendance-periods/${id}`);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        throw new Error(`V2 Attendance API access denied. This may be due to insufficient scopes. Error: ${error.response?.data?.error?.message || error.message}`);
      }
      throw error;
    }
  }

  // Create attendance period (v2)
  async createAttendancePeriodV2(params: AttendancePeriodV2Request): Promise<AttendancePeriodV2CreateResponse> {
    try {
      const response = await this.axiosInstance.post('/v2/attendance-periods', params);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        throw new Error(`V2 Attendance API access denied. This may be due to insufficient scopes. Required scope may be different from 'attendances:write'. Error: ${error.response?.data?.error?.message || error.message}`);
      }
      throw error;
    }
  }

  // Update attendance period (v2)
  async updateAttendancePeriodV2(id: string | number, params: Partial<AttendancePeriodV2Request>): Promise<PersonioApiResponseV2<AttendancePeriodV2>> {
    try {
      const response = await this.axiosInstance.patch(`/v2/attendance-periods/${id}`, params);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        throw new Error(`V2 Attendance API access denied. This may be due to insufficient scopes. Error: ${error.response?.data?.error?.message || error.message}`);
      }
      throw error;
    }
  }

  // Delete attendance period (v2)
  async deleteAttendancePeriodV2(id: string | number): Promise<PersonioApiResponseV2<any>> {
    try {
      const response = await this.axiosInstance.delete(`/v2/attendance-periods/${id}`);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        throw new Error(`V2 Attendance API access denied. This may be due to insufficient scopes. Error: ${error.response?.data?.error?.message || error.message}`);
      }
      throw error;
    }
  }

  // Helper method to format v2 attendance data for display
  formatAttendanceDataV2(attendance: AttendancePeriodV2): any {
    return {
      id: attendance.id,
      type: attendance.type,
      person_id: attendance.person.id,
      approval_status: attendance.approval?.status,
      start_date_time: attendance.start.date_time,
      end_date_time: attendance.end?.date_time,
      attribution_date: attendance.attribution_date,
      comment: attendance.comment,
      is_holiday: attendance.is_holiday,
      is_on_time_off: attendance.is_on_time_off,
      is_auto_generated: attendance.is_auto_generated,
      created_at: attendance.created_at,
      updated_at: attendance.updated_at,
    };
  }

  // Helper method to convert v1 format to v2 format for backward compatibility
  convertV1ToV2Format(v1Attendance: any): AttendancePeriodV2Request {
    // Convert date + time format to ISO datetime
    const startDateTime = `${v1Attendance.date}T${v1Attendance.start_time}:00`;
    const endDateTime = v1Attendance.end_time ? `${v1Attendance.date}T${v1Attendance.end_time}:00` : undefined;

    return {
      person: { id: String(v1Attendance.employee_id) },
      type: 'WORK',
      start: {
        date_time: startDateTime,
      },
      end: endDateTime ? {
        date_time: endDateTime,
      } : undefined,
      comment: v1Attendance.comment,
    };
  }

  // ====== V2 Recruiting API Methods ======

  // Private helper for recruiting GET requests (sets Beta: true header)
  // Normalizes response to always use { _data, _meta } shape regardless of API variations
  private async recruitingGet<T>(path: string, params?: URLSearchParams): Promise<PersonioRecruitingResponse<T>> {
    try {
      const url = params && params.toString() ? `${path}?${params}` : path;
      const response = await this.axiosInstance.get(url, {
        headers: { 'Beta': 'true' },
      });

      const body = response.data;

      // Normalize: API may use _data (list endpoints) or data (single/some endpoints)
      if (body._data !== undefined) {
        return body;
      }
      if (body.data !== undefined) {
        return { _data: body.data, _meta: body._meta || body.meta };
      }
      // Fallback: response body IS the data (no wrapper)
      return { _data: body as T, _meta: undefined };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        throw new Error(
          `Recruiting API access denied. Ensure your API credentials have the 'personio:recruiting:read' scope. ` +
          `Error: ${error.response?.data?.error?.message || error.response?.data?.message || error.message}`
        );
      }
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new Error(`Not found: ${path}`);
      }
      throw error;
    }
  }

  // List recruiting applications
  async getRecruitingApplications(params?: {
    limit?: number;
    cursor?: string;
    updated_at_after?: string;
    updated_at_before?: string;
    candidate_email?: string;
  }): Promise<PersonioRecruitingResponse<RecruitingApplication[]>> {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.cursor) queryParams.append('cursor', params.cursor);
    if (params?.updated_at_after) queryParams.append('updated_at.gt', params.updated_at_after);
    if (params?.updated_at_before) queryParams.append('updated_at.lt', params.updated_at_before);
    if (params?.candidate_email) queryParams.append('candidate.email', params.candidate_email);
    return this.recruitingGet<RecruitingApplication[]>('/v2/recruiting/applications', queryParams);
  }

  // Get single recruiting application
  async getRecruitingApplication(id: string): Promise<PersonioRecruitingResponse<RecruitingApplication>> {
    return this.recruitingGet<RecruitingApplication>(`/v2/recruiting/applications/${id}`);
  }

  // List stage transitions for an application
  async getApplicationStageTransitions(applicationId: string): Promise<PersonioRecruitingResponse<RecruitingStageTransition[]>> {
    return this.recruitingGet<RecruitingStageTransition[]>(`/v2/recruiting/applications/${applicationId}/stage-transitions`);
  }

  // List recruiting candidates
  async getRecruitingCandidates(params?: {
    limit?: number;
    cursor?: string;
  }): Promise<PersonioRecruitingResponse<RecruitingCandidate[]>> {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.cursor) queryParams.append('cursor', params.cursor);
    return this.recruitingGet<RecruitingCandidate[]>('/v2/recruiting/candidates', queryParams);
  }

  // Get single recruiting candidate
  async getRecruitingCandidate(id: string): Promise<PersonioRecruitingResponse<RecruitingCandidate>> {
    return this.recruitingGet<RecruitingCandidate>(`/v2/recruiting/candidates/${id}`);
  }

  // List recruiting jobs
  async getRecruitingJobs(params?: {
    limit?: number;
    cursor?: string;
  }): Promise<PersonioRecruitingResponse<RecruitingJob[]>> {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.cursor) queryParams.append('cursor', params.cursor);
    return this.recruitingGet<RecruitingJob[]>('/v2/recruiting/jobs', queryParams);
  }

  // Get single recruiting job
  async getRecruitingJob(id: string): Promise<PersonioRecruitingResponse<RecruitingJob>> {
    return this.recruitingGet<RecruitingJob>(`/v2/recruiting/jobs/${id}`);
  }

  // List recruiting categories
  async getRecruitingCategories(): Promise<PersonioRecruitingResponse<RecruitingCategory[]>> {
    return this.recruitingGet<RecruitingCategory[]>('/v2/recruiting/categories');
  }

  // Recruiting formatter methods
  formatRecruitingApplication(app: any): any {
    if (!app) return app;
    return {
      id: app.id,
      application_date: app.application_date,
      candidate: app.candidate ? {
        id: app.candidate.id,
        name: `${app.candidate.first_name || ''} ${app.candidate.last_name || ''}`.trim(),
        email: app.candidate.email,
        gender: app.candidate.gender,
      } : null,
      job: app.job ? {
        id: app.job.id,
        name: app.job.name,
        department: app.job.department?.name,
      } : null,
      current_stage: app.current_stage ? {
        name: app.current_stage.name,
        type: app.current_stage.type,
      } : null,
      channel: app.channel?.name,
      is_anonymized: app.is_anonymized,
      created_at: app.created_at?.['date-time'] || app.created_at,
      updated_at: app.updated_at?.['date-time'] || app.updated_at,
    };
  }

  formatRecruitingCandidate(candidate: any): any {
    if (!candidate) return candidate;
    return {
      id: candidate.id,
      first_name: candidate.first_name,
      last_name: candidate.last_name,
      name: `${candidate.first_name || ''} ${candidate.last_name || ''}`.trim(),
      email: candidate.email,
      gender: candidate.gender,
      phone: candidate.phone,
      location: candidate.location,
      linkedin_profile: candidate.linkedin_profile,
      applications: candidate.applications?.map((a: any) => ({
        id: a.id,
        application_date: a.application_date,
      })),
      created_at: candidate.created_at,
      updated_at: candidate.updated_at,
    };
  }

  formatRecruitingJob(job: any): any {
    if (!job) return job;
    return {
      id: job.id,
      name: job.name,
      department: job.department?.name,
      category: job.category?.name || job.category,
      hiring_team: job.hiring_team?.map((h: any) => ({
        person_id: h.person?.id,
        role: h.role?.name,
      })),
      created_at: job.created_at?.['date-time'] || job.created_at,
      updated_at: job.updated_at?.['date-time'] || job.updated_at,
    };
  }

  formatStageTransition(transition: any): any {
    if (!transition) return transition;
    return {
      stage_name: transition.stage?.name,
      stage_type: transition.stage?.type,
      stage_kind: transition.stage?.kind,
      entered_at: transition.entered_at?.['date-time'] || transition.entered_at,
    };
  }

  formatRecruitingCategory(category: any): any {
    if (!category) return category;
    return {
      id: category.id,
      name: category.name,
      stages: category.stages?.map((s: any) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        kind: s.kind,
      })),
    };
  }

  // ====== V2 Document Management API (for recruiting documents) ======

  // List documents for an application (uses application_id as owner_id)
  // Uses Document Management API (NOT the Recruiting API) — no Beta header, default scope
  async getApplicationDocuments(applicationId: string, params?: {
    category_id?: string;
    limit?: number;
    cursor?: string;
  }): Promise<PersonioRecruitingResponse<any[]>> {
    const queryParams = new URLSearchParams();
    queryParams.append('owner_id', applicationId);
    if (params?.category_id) queryParams.append('category_id', params.category_id);
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.cursor) queryParams.append('cursor', params.cursor);

    // Use a fresh axios instance to avoid the global error interceptor
    const authHeader = await this.auth.getAuthHeader();
    const response = await axios.get(`${this.baseUrl}/v2/document-management/documents?${queryParams}`, {
      headers: { ...authHeader, Accept: 'application/json' },
      timeout: 30000,
    });
    const body = response.data;
    if (body._data !== undefined) return body;
    if (body.data !== undefined) return { _data: body.data, _meta: body._meta || body.meta };
    return { _data: body as any[], _meta: undefined };
  }

  // Download a document by ID (returns binary Buffer)
  // Uses Document Management API — no Beta header, default scope
  async downloadApplicationDocument(documentId: string): Promise<Buffer> {
    const authHeader = await this.auth.getAuthHeader();
    const response = await axios.get(
      `${this.baseUrl}/v2/document-management/documents/${documentId}/download`,
      {
        headers: { ...authHeader },
        responseType: 'arraybuffer',
        timeout: 60000,
      }
    );
    return Buffer.from(response.data);
  }

  formatApplicationDocument(doc: any): any {
    if (!doc) return doc;
    return {
      id: doc.id,
      name: doc.name,
      date: doc.date,
      comment: doc.comment,
      category_id: doc.category?.id,
      owner_id: doc.owner?.id,
      document_type: doc.document_type,
      size: doc.size,
      created_at: doc.created_at,
      virus_scan_status: doc.virus_scan?.status,
    };
  }

  // Helper method to convert v2 format to v1 format for backward compatibility
  convertV2ToV1Format(v2Attendance: AttendancePeriodV2): any {
    // date_time is in format "2026-03-12T03:00:00" — extract date and time parts
    const startParts = v2Attendance.start.date_time.split('T');
    const endParts = v2Attendance.end?.date_time?.split('T');

    return {
      id: v2Attendance.id,
      employee_id: v2Attendance.person.id,
      date: startParts[0],
      start_time: startParts[1]?.substring(0, 5),
      end_time: endParts ? endParts[1]?.substring(0, 5) : null,
      break_minutes: 0, // V2 doesn't have break field directly
      comment: v2Attendance.comment || '',
      is_holiday: v2Attendance.is_holiday,
      is_on_time_off: v2Attendance.is_on_time_off,
      updated_at: v2Attendance.updated_at,
    };
  }
}
