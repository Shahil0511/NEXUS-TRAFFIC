/**
 * Detects and replaces personal data (email, phone, PAN, GSTIN, Aadhaar) in ingested text fields
 * (ADR 0010). SCRUB, NEVER REJECT: the event is kept with the match replaced; the caller reports
 * FIELD_REDACTED and counts the detection. The matched value is NEVER stored, returned or logged.
 *
 * Two passes (the enrichers decide which field gets which method):
 * - pass 1, BEFORE RouteNormalizer / toEndpointId (so ids are computed on scrubbed text):
 *   scrubPathLike (path, route_template, referrer_path — STRICT patterns, so numeric ids survive),
 *   scrubOpaqueId (request_id, release — the same STRICT patterns: hex / UUID ids hold digit runs),
 *   scrubText (free text — looser patterns; tokens), scrubIdentifier (tool / name — `redacted`);
 * - pass 2, AFTER the ids: scrubStoredPathSegments on the STORED path / referrer_path only — a whole
 *   segment that is a bare mobile or a Verhoeff-valid 12-digit number. Ids never split.
 * Patterns come from @nexus/shared constants/pii.ts, compiled ONCE here (flags `gi`), and run in
 * PII_DETECTION_ORDER; GSTIN and Aadhaar matches are post-filtered by their checksums.
 */
import {
  isGstinChecksumValid,
  isVerhoeffValid,
  PII_DETECTION_ORDER,
  PII_IDENTIFIER_REDACTION,
  PII_PATH_PATTERN_SOURCES,
  PII_REDACTION_TOKENS,
  PII_SEGMENT_PATTERN_SOURCES,
  PII_TEXT_PATTERN_SOURCES,
  type PiiKind,
} from '@nexus/shared';

export interface ScrubResult {
  /** The value with every match replaced (unchanged when `kinds` is empty). */
  value: string;
  /** Distinct kinds detected, in detection order. */
  kinds: PiiKind[];
}

interface CompiledPattern {
  kind: PiiKind;
  regex: RegExp;
}

/** Checksum post-filters: a match that fails its checksum is NOT PII (left as is). */
const POST_FILTERS: Readonly<Partial<Record<PiiKind, (match: string) => boolean>>> = {
  gstin: isGstinChecksumValid,
  aadhaar: isVerhoeffValid,
};

const PATH_SEPARATOR = '/';

function compile(sources: Readonly<Record<PiiKind, string>>): readonly CompiledPattern[] {
  return PII_DETECTION_ORDER.map((kind) => ({ kind, regex: new RegExp(sources[kind], 'gi') }));
}

/** WHY: one compiled pattern set + one replacement policy per field family (ADR 0010). */
export class PiiScrubber {
  private readonly pathPatterns = compile(PII_PATH_PATTERN_SOURCES);
  private readonly textPatterns = compile(PII_TEXT_PATTERN_SOURCES);
  private readonly segmentPhone = new RegExp(PII_SEGMENT_PATTERN_SOURCES.phone);
  private readonly segmentAadhaar = new RegExp(PII_SEGMENT_PATTERN_SOURCES.aadhaar);

  /** path / route_template / referrer_path: strict patterns, match → `:kind` token. */
  scrubPathLike(value: string): ScrubResult {
    return this.replaceAll(value, this.pathPatterns, (kind) => PII_REDACTION_TOKENS[kind]);
  }

  /**
   * request_id / release (the caller drops the field on a match): STRICT patterns, because a random
   * hex or UUID id often contains a 10-digit run starting 6-9 that is not a mobile number.
   */
  scrubOpaqueId(value: string): ScrubResult {
    return this.replaceAll(value, this.pathPatterns, (kind) => PII_REDACTION_TOKENS[kind]);
  }

  /** label / prop_value (replace) and prop_key / error_code (caller drops). */
  scrubText(value: string): ScrubResult {
    return this.replaceAll(value, this.textPatterns, (kind) => PII_REDACTION_TOKENS[kind]);
  }

  /** tool / name: match → `redacted`, so the value still matches TOOL_NAME_PATTERN. */
  scrubIdentifier(value: string): ScrubResult {
    return this.replaceAll(value, this.textPatterns, () => PII_IDENTIFIER_REDACTION);
  }

  /** Pass 2 on a STORED path: whole bare-mobile / Verhoeff-valid 12-digit segments → `:phone` / `:aadhaar`. */
  scrubStoredPathSegments(value: string): ScrubResult {
    const kinds = new Set<PiiKind>();
    const segments = value.split(PATH_SEPARATOR).map((segment) => {
      const kind = this.segmentKind(segment);
      if (!kind) return segment;
      kinds.add(kind);
      return PII_REDACTION_TOKENS[kind];
    });
    return { value: kinds.size > 0 ? segments.join(PATH_SEPARATOR) : value, kinds: [...kinds] };
  }

  private segmentKind(segment: string): PiiKind | null {
    if (this.segmentPhone.test(segment)) return 'phone';
    if (this.segmentAadhaar.test(segment) && isVerhoeffValid(segment)) return 'aadhaar';
    return null;
  }

  private replaceAll(
    value: string,
    patterns: readonly CompiledPattern[],
    replacement: (kind: PiiKind) => string,
  ): ScrubResult {
    const kinds: PiiKind[] = [];
    let current = value;
    for (const { kind, regex } of patterns) {
      const accept = POST_FILTERS[kind];
      let found = false;
      current = current.replace(regex, (match) => {
        if (accept && !accept(match)) return match;
        found = true;
        return replacement(kind);
      });
      if (found) kinds.push(kind);
    }
    return { value: current, kinds };
  }
}
