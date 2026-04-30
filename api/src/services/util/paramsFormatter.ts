import { ApiServiceGetParam } from '../apiIntegrationTypes.js';

export type DateOutputFormat = 'YYYY-MM-DD' | 'DD/MM/YYYY';

type FormatOptions = {
  dateOutputFormat?: DateOutputFormat;
  powerStockUtcRangeDateTime?: boolean;
};

function parseDateParts(value: string): { year: number; month: number; day: number } | null {
  const trimmed = value.trim();
  const ymd = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?$/.exec(trimmed);
  if (ymd) {
    return {
      year: Number(ymd[1]),
      month: Number(ymd[2]),
      day: Number(ymd[3]),
    };
  }

  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s\d{2}:\d{2}(?::\d{2})?)?$/.exec(trimmed);
  if (dmy) {
    return {
      year: Number(dmy[3]),
      month: Number(dmy[2]),
      day: Number(dmy[1]),
    };
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    year: parsed.getFullYear(),
    month: parsed.getMonth() + 1,
    day: parsed.getDate(),
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function toUtcIsoFromLocalDate(parts: { year: number; month: number; day: number }, endOfDay: boolean): string {
  const local = new Date(
    parts.year,
    parts.month - 1,
    parts.day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0
  );
  return local.toISOString();
}

export function formatGetParamValue(
  param: Pick<ApiServiceGetParam, 'value_type' | 'value'>,
  options?: FormatOptions
): string {
  const rawValue = String(param.value ?? '').trim();
  if (!rawValue) return '';

  if (param.value_type === 'number') {
    const normalized = rawValue.replace(',', '.');
    const asNumber = Number(normalized);
    return Number.isFinite(asNumber) ? String(asNumber) : rawValue;
  }

  if (param.value_type === 'date') {
    const parts = parseDateParts(rawValue);
    if (!parts) return rawValue;
    const dateFormat = options?.dateOutputFormat ?? 'YYYY-MM-DD';
    if (dateFormat === 'DD/MM/YYYY') {
      return `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year}`;
    }
    return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
  }

  return rawValue;
}

function applyPowerStockDateRangeForParam(
  param: Pick<ApiServiceGetParam, 'name' | 'value_type' | 'value'>,
  options?: FormatOptions
): string | null {
  if (!options?.powerStockUtcRangeDateTime) return null;
  if (param.value_type !== 'date') return null;
  const rawValue = String(param.value ?? '').trim();
  if (!rawValue) return null;

  const parts = parseDateParts(rawValue);
  if (!parts) return null;

  const normalizedName = param.name.trim().toLowerCase();
  if (normalizedName === 'dataemissaoinicio') return toUtcIsoFromLocalDate(parts, false);
  if (normalizedName === 'dataemissaofim') return toUtcIsoFromLocalDate(parts, true);
  return null;
}

function formatParamForOutput(
  param: Pick<ApiServiceGetParam, 'name' | 'value_type' | 'value'>,
  options?: FormatOptions
): string {
  const rangeValue = applyPowerStockDateRangeForParam(param, options);
  if (rangeValue) return rangeValue;
  const baseValue = formatGetParamValue(param, options);
  return baseValue;
}

export function buildHeaderParamsFromGetParams(
  params: ApiServiceGetParam[],
  options?: FormatOptions
): Record<string, string> {
  const ordered = [...params].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const headers: Record<string, string> = {};
  for (const param of ordered) {
    if (!param?.name?.trim()) continue;
    const name = param.name.trim();
    headers[name] = formatParamForOutput(param, options);
  }
  return headers;
}

export function buildQueryStringFromGetParams(
  params: ApiServiceGetParam[],
  options?: FormatOptions
): string {
  const ordered = [...params].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return ordered
    .filter((param) => Boolean(param?.name?.trim()))
    .map((param) => {
      const name = encodeURIComponent(param.name.trim());
      const value = encodeURIComponent(formatParamForOutput(param, options));
      return `${name}=${value}`;
    })
    .join('&');
}

export function mergeUrlWithQuery(baseUrl: string, queryString: string): string {
  const trimmedQuery = queryString.trim().replace(/^&+|&+$/g, '');
  if (!trimmedQuery) return baseUrl;
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${trimmedQuery}`;
}
