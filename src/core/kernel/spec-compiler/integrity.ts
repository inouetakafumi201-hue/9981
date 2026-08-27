import type { DefKind } from '../state/def';
import { canonicalStringify, compareCodePoints } from './json-codec';
import type { CompiledModel, JsonValue, SchemaVersion } from './types';

/** One way the activated model failed to describe what the candidate actually said. */
export interface SemanticDamage {
  readonly definitionId: string;
  readonly detail: string;
}

/**
 * Members that describe the change set rather than the definition, and are therefore expected to be
 * absent from the activated model. Everything else must survive verbatim.
 */
const TRANSACTION_INTENT_FIELDS: ReadonlySet<string> = new Set(['override']);

/**
 * Self-check: prove that no semantic field was lost between the parsed candidate and the model that is
 * about to be published.
 *
 * Every other check in the pipeline asks whether the creator's input is legal. This one asks whether the
 * compiler itself carried that input through faithfully, which is a different failure mode and one the
 * creator cannot see or fix. It exists because the pipeline gained several rewriting steps (working-set
 * merge, override stripping, resolution, canonicalisation) and a silent drop in any of them would publish
 * a specification that quietly says less than the document it came from. Detecting that is only useful if
 * it happens before publication, so the caller must run it while nothing is committed yet.
 *
 * Presentation fields are deliberately out of scope. They are the one category the specification allows to
 * degrade to a type-compatible fallback with a warning, so a difference there is a sanctioned outcome, not
 * damage. Treating it as damage would convert an accepted creator-facing degradation into a system fault.
 */
export function findSemanticFieldDamage(
  parsedRoot: JsonValue,
  model: CompiledModel,
  schema: SchemaVersion,
): readonly SemanticDamage[] {
  const damage: SemanticDamage[] = [];
  const parsedDefinitions = isRecord(parsedRoot) ? parsedRoot['definitions'] : undefined;
  if (Array.isArray(parsedDefinitions)) {
    for (const entry of parsedDefinitions) {
      if (!isRecord(entry) || typeof entry['id'] !== 'string') continue;
      damage.push(...compareOneDefinition(entry, entry['id'], model, schema));
    }
  }
  for (const id of Object.keys(model.definitions).sort(compareCodePoints)) {
    if (model.resolvedDefinitions[id]) continue;
    damage.push({ definitionId: id, detail: 'activated definition has no resolved form' });
  }
  return damage;
}

function compareOneDefinition(
  entry: Readonly<Record<string, JsonValue>>,
  id: string,
  model: CompiledModel,
  schema: SchemaVersion,
): readonly SemanticDamage[] {
  const stored = model.definitions[id];
  if (!stored) {
    return [{ definitionId: id, detail: 'candidate definition is absent from the activated model' }];
  }
  const fields = schema.definitionSchemas.get(stored.kind as DefKind)?.fields ?? {};
  const damage: SemanticDamage[] = [];
  for (const field of Object.keys(entry).sort(compareCodePoints)) {
    const rule = fields[field];
    // A presentation field may differ from the document in exactly one way: it may hold the fallback the
    // schema registered for it, which is the degradation the creator was warned about. Any other value is
    // still reported, so "presentation" cannot become a blanket exemption from the integrity check.
    if (rule?.presentation === true && rule.fallback !== undefined &&
        canonicalStringify(stored.value[field] ?? null) === canonicalStringify(rule.fallback)) {
      continue;
    }
    if (TRANSACTION_INTENT_FIELDS.has(field)) {
      if (stored.value[field] !== undefined) {
        damage.push({ definitionId: id, detail: `transaction intent ${field} leaked into the model` });
      }
      continue;
    }
    const declared = entry[field] as JsonValue;
    const kept = stored.value[field];
    if (kept === undefined) {
      damage.push({ definitionId: id, detail: `field ${field} was dropped` });
      continue;
    }
    if (canonicalStringify(kept) !== canonicalStringify(declared)) {
      damage.push({ definitionId: id, detail: `field ${field} changed value` });
    }
  }
  return damage;
}

function isRecord(value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);
}
