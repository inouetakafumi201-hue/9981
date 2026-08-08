import type { Effect } from '../events/effect-types.js';
import type { Diagnostic } from '../state/diagnostic.js';
import type { Def, DefKind } from '../state/def.js';
import type { ErrCode } from '../state/error-codes.js';
import type { Expr, Query } from '../state/expr-types.js';
import type { JsonValue, ParsedCandidateDocument } from '../spec-compiler/types.js';
import type { PlaypackDef } from './playpack.js';

export type PlaypackDecodeResult =
  | { readonly ok: true; readonly value: PlaypackDef }
  | { readonly ok: false; readonly diagnostics: Diagnostic[] };

const DEF_KINDS = new Set<DefKind>([
  'entity', 'item', 'node', 'link', 'attachment', 'action', 'rule',
  'playpack', 'decision', 'prefab', 'expr', 'schedule', 'policy',
]);
const QUERY_FROM = new Set([
  'entities', 'items', 'nodes', 'links', 'attachments', 'defs',
  'agents', 'decisions', 'intents', 'log',
]);
const EFFECT_KEYS = ['op', 'let', 'if', 'forEach', 'while', 'emit', 'after', 'at', 'try', 'abort'] as const;
const EXPR_KEYS = ['path', 'var', 'op', 'q', 'call'] as const;
const COMMON_DEF_FIELDS = new Set([
  'id', 'kind', 'extends', 'abstract', 'tags', 'props', 'containers',
  'slots', 'actions', 'rules', 'clamp', 'schema',
]);
const PLAYPACK_FIELDS = new Set([
  ...COMMON_DEF_FIELDS, 'version', 'schedule', 'pools', 'conflicts',
  'visibility', 'logRetention', 'outcomes', 'evaluate', 'policies',
  'entry', 'requires', 'defs', 'hookOrder', 'overrides', 'linter',
]);

interface OpEffectWithResult {
  readonly op: string;
  readonly args: Record<string, Expr>;
  readonly result?: string;
}

type JsonEffect = Effect | OpEffectWithResult;
type JsonObject = Record<string, unknown>;

/** Strictly decodes an already-parsed, pure-JSON playpack document. */
export function decodePlaypack(document: ParsedCandidateDocument): PlaypackDecodeResult {
  return new PlaypackCodec().decode(document);
}

/** Stateful only for one decode call; a codec instance may be reused sequentially. */
export class PlaypackCodec {
  decode(document: ParsedCandidateDocument): PlaypackDecodeResult {
    const validator = new Validator(document);
    validator.validate();
    if (validator.diagnostics.length > 0) {
      return { ok: false, diagnostics: validator.diagnostics };
    }
    // Every reachable member has been recursively checked below. The cast also deliberately
    // bridges op Effect.result, which is accepted by the JSON contract before the core type grows it.
    return { ok: true, value: document.value as unknown as PlaypackDef };
  }
}

class Validator {
  readonly diagnostics: Diagnostic[] = [];

  constructor(private readonly document: ParsedCandidateDocument) {}

  validate(): void {
    if (!this.validateJsonSafety(this.document.value, '', new Set<object>())) return;
    if (!this.record(this.document.value, '', 'playpack root')) return;
    this.playpack(this.document.value, '');
  }

  private playpack(value: JsonObject, path: string): void {
    this.knownFields(value, PLAYPACK_FIELDS, path);
    if (Object.prototype.hasOwnProperty.call(value, 'linter')) {
      this.problem(
        'E_LOAD_PROHIBITED_CONSTRUCT',
        this.child(path, 'linter'),
        'JSON playpacks cannot declare linter because executable checks are not JSON data',
      );
    }

    this.commonDef(value, path);
    const kind = this.requiredString(value, 'kind', path);
    if (kind !== undefined && kind !== 'playpack') {
      this.problem('E_LOAD_DEF_KIND', this.child(path, 'kind'), 'Playpack root kind must be playpack');
    }
    this.requiredString(value, 'version', path);

    this.optionalString(value, 'schedule', path);
    this.optionalStringArray(value, 'conflicts', path);
    this.optionalString(value, 'visibility', path);
    this.optionalStringArray(value, 'policies', path);
    this.optionalStringArray(value, 'requires', path);
    this.optionalStringArray(value, 'hookOrder', path);

    const pools = this.optionalArray(value, 'pools', path);
    pools?.forEach((pool, index) => this.pool(pool, `${this.child(path, 'pools')}/${index}`));

    const retention = this.optionalRecord(value, 'logRetention', path);
    if (retention) {
      const retentionPath = this.child(path, 'logRetention');
      this.knownFields(retention, new Set(['phases', 'max']), retentionPath);
      this.optionalNonNegativeInteger(retention, 'phases', retentionPath);
      this.optionalNonNegativeInteger(retention, 'max', retentionPath);
    }

    const outcomes = this.optionalArray(value, 'outcomes', path);
    outcomes?.forEach((outcome, index) => this.outcome(outcome, `${this.child(path, 'outcomes')}/${index}`));

    if (value['evaluate'] !== undefined) this.expr(value['evaluate'], this.child(path, 'evaluate'));
    if (value['entry'] !== undefined) this.effectArray(value['entry'], this.child(path, 'entry'));

    const overrides = this.optionalRecord(value, 'overrides', path);
    if (overrides) {
      const overridesPath = this.child(path, 'overrides');
      for (const [key, target] of Object.entries(overrides)) {
        if (key.length === 0) this.problem('E_LOAD_IDENTIFIER_INVALID', overridesPath, 'Override source id must not be empty');
        if (typeof target !== 'string' || target.length === 0) {
          this.problem('E_LOAD_FIELD_TYPE', this.child(overridesPath, key), 'Override target must be a non-empty string');
        }
      }
    }

    const defs = this.requiredArray(value, 'defs', path);
    if (defs) {
      const seen = new Set<string>();
      defs.forEach((definition, index) => {
        const defPath = `${this.child(path, 'defs')}/${index}`;
        this.definition(definition, defPath);
        if (isRecord(definition) && typeof definition['id'] === 'string') {
          const id = definition['id'];
          if (seen.has(id)) this.problem('E_LOAD_DUPLICATE_ID', this.child(defPath, 'id'), `Definition id ${id} is duplicated`);
          seen.add(id);
        }
      });
    }
  }

  private pool(value: unknown, path: string): void {
    if (!this.record(value, path, 'pool')) return;
    this.knownFields(value, new Set(['name', 'per', 'min', 'max', 'initial', 'reset', 'resetTo']), path);
    this.requiredString(value, 'name', path);
    this.requiredEnum(value, 'per', path, ['world', 'actor', 'faction']);
    for (const key of ['min', 'max', 'initial', 'resetTo'] as const) {
      if (value[key] !== undefined) this.expr(value[key], this.child(path, key));
    }
    if (value['reset'] === undefined) {
      this.missing(path, 'reset');
    } else if (typeof value['reset'] === 'string' && ['never', 'turn', 'phase'].includes(value['reset'])) {
      // Named reset modes are the compact form; all other JSON Expr values are also valid.
    } else {
      this.expr(value['reset'], this.child(path, 'reset'));
    }
  }

  private outcome(value: unknown, path: string): void {
    if (!this.record(value, path, 'outcome')) return;
    this.knownFields(value, new Set(['name', 'when', 'scope', 'rank', 'onReach', 'ends']), path);
    this.requiredString(value, 'name', path);
    this.requiredExpr(value, 'when', path);
    this.requiredEnum(value, 'scope', path, ['game', 'agent', 'faction']);
    if (value['rank'] !== undefined) this.expr(value['rank'], this.child(path, 'rank'));
    if (value['onReach'] !== undefined) this.effectArray(value['onReach'], this.child(path, 'onReach'));
    this.requiredBoolean(value, 'ends', path);
  }

  private definition(value: unknown, path: string): void {
    if (!this.record(value, path, 'definition')) return;
    this.commonDef(value, path);
    const kindValue = value['kind'];
    if (typeof kindValue !== 'string' || !DEF_KINDS.has(kindValue as DefKind)) return;

    switch (kindValue as DefKind) {
      case 'action': this.actionDef(value, path); break;
      case 'rule': this.ruleDef(value, path); break;
      case 'attachment': this.attachmentDef(value, path); break;
      case 'schedule': this.scheduleDef(value, path); break;
      case 'expr': this.exprDef(value, path); break;
      case 'playpack': this.playpack(value, path); break;
      default:
        // Open Def kinds have no narrower runtime interface yet. Their common fields were checked,
        // and validateJsonSafety has already recursively rejected non-JSON/non-finite content.
        break;
    }
  }

  private commonDef(value: JsonObject, path: string): void {
    const id = this.requiredString(value, 'id', path);
    if (id !== undefined && id.length === 0) {
      this.problem('E_LOAD_IDENTIFIER_INVALID', this.child(path, 'id'), 'Definition id must not be empty');
    }
    const kind = this.requiredString(value, 'kind', path);
    if (kind !== undefined && !DEF_KINDS.has(kind as DefKind)) {
      this.problem('E_LOAD_DEF_KIND', this.child(path, 'kind'), `Unknown definition kind ${kind}`);
    }
    this.optionalStringArray(value, 'extends', path);
    this.optionalBoolean(value, 'abstract', path);
    this.optionalStringArray(value, 'tags', path);
    this.optionalStringArray(value, 'actions', path);
    this.optionalStringArray(value, 'rules', path);

    const props = this.optionalRecord(value, 'props', path);
    if (props) this.validateJsonSafety(props, this.child(path, 'props'), new Set<object>());

    const containers = this.optionalArray(value, 'containers', path);
    containers?.forEach((container, index) => {
      const containerPath = `${this.child(path, 'containers')}/${index}`;
      if (!this.record(container, containerPath, 'container')) return;
      this.knownFields(container, new Set(['name', 'insert', 'slots']), containerPath);
      this.requiredString(container, 'name', containerPath);
      this.requiredEnum(container, 'insert', containerPath, ['fixed', 'shift']);
      this.optionalNonNegativeInteger(container, 'slots', containerPath);
    });

    const slots = this.optionalArray(value, 'slots', path);
    slots?.forEach((slot, index) => {
      const slotPath = `${this.child(path, 'slots')}/${index}`;
      if (!this.record(slot, slotPath, 'slot')) return;
      this.knownFields(slot, new Set(['tags', 'accepts']), slotPath);
      this.optionalStringArray(slot, 'tags', slotPath);
      if (slot['accepts'] !== undefined) this.expr(slot['accepts'], this.child(slotPath, 'accepts'));
    });

    const clamp = this.optionalRecord(value, 'clamp', path);
    if (clamp) {
      const clampPath = this.child(path, 'clamp');
      for (const [key, bounds] of Object.entries(clamp)) {
        const boundsPath = this.child(clampPath, key);
        if (!this.record(bounds, boundsPath, 'clamp bounds')) continue;
        this.knownFields(bounds, new Set(['min', 'max', 'int']), boundsPath);
        this.optionalFiniteNumber(bounds, 'min', boundsPath);
        this.optionalFiniteNumber(bounds, 'max', boundsPath);
        this.optionalBoolean(bounds, 'int', boundsPath);
      }
    }

    if (value['schema'] !== undefined && !isRecord(value['schema'])) {
      this.problem('E_LOAD_FIELD_TYPE', this.child(path, 'schema'), 'schema must be an object');
    }
  }

  private actionDef(value: JsonObject, path: string): void {
    this.knownFields(value, this.withCommon(['label', 'targets', 'require', 'visible', 'reason', 'cost', 'group', 'effects']), path);
    this.requiredExpr(value, 'label', path);
    for (const key of ['require', 'visible', 'reason'] as const) {
      if (value[key] !== undefined) this.expr(value[key], this.child(path, key));
    }
    this.optionalString(value, 'group', path);
    const effects = this.requiredArray(value, 'effects', path);
    if (effects) this.effectArray(effects, this.child(path, 'effects'));

    const targets = this.optionalArray(value, 'targets', path);
    targets?.forEach((target, index) => this.target(target, `${this.child(path, 'targets')}/${index}`));
    const costs = this.optionalArray(value, 'cost', path);
    costs?.forEach((cost, index) => this.cost(cost, `${this.child(path, 'cost')}/${index}`));
  }

  private target(value: unknown, path: string): void {
    if (!this.record(value, path, 'action target')) return;
    this.knownFields(value, new Set(['name', 'query', 'range', 'count', 'optional']), path);
    this.requiredString(value, 'name', path);
    if (value['query'] !== undefined) this.query(value['query'], this.child(path, 'query'));
    const range = this.optionalRecord(value, 'range', path);
    if (range) {
      const rangePath = this.child(path, 'range');
      this.knownFields(range, new Set(['min', 'max', 'step']), rangePath);
      for (const key of ['min', 'max', 'step'] as const) this.requiredExpr(range, key, rangePath);
    }
    const count = this.optionalRecord(value, 'count', path);
    if (count) {
      const countPath = this.child(path, 'count');
      this.knownFields(count, new Set(['min', 'max']), countPath);
      this.requiredExpr(count, 'min', countPath);
      this.requiredExpr(count, 'max', countPath);
    }
    this.optionalBoolean(value, 'optional', path);
  }

  private cost(value: unknown, path: string): void {
    if (!this.record(value, path, 'action cost')) return;
    const forms = ['pool', 'items', 'attach', 'custom'].filter((key) => Object.prototype.hasOwnProperty.call(value, key));
    if (forms.length !== 1) {
      this.problem('E_LOAD_CROSS_FIELD_CONSTRAINT', path, 'Cost must use exactly one of pool, items, attach, or custom');
      return;
    }
    switch (forms[0]) {
      case 'pool':
        this.knownFields(value, new Set(['pool', 'amount']), path);
        this.requiredString(value, 'pool', path);
        this.requiredExpr(value, 'amount', path);
        break;
      case 'items':
        this.knownFields(value, new Set(['items']), path);
        this.requiredExpr(value, 'items', path);
        break;
      case 'attach':
        this.knownFields(value, new Set(['attach']), path);
        this.requiredString(value, 'attach', path);
        break;
      case 'custom':
        this.knownFields(value, new Set(['custom']), path);
        if (value['custom'] === undefined) this.missing(path, 'custom');
        else this.effectArray(value['custom'], this.child(path, 'custom'));
        break;
    }
  }

  private ruleDef(value: JsonObject, path: string): void {
    this.knownFields(value, this.withCommon(['on', 'phase', 'when', 'priority', 'effects', 'once']), path);
    const on = value['on'];
    if (on === undefined) this.missing(path, 'on');
    else if (typeof on !== 'string' && !(Array.isArray(on) && on.every((item) => typeof item === 'string'))) {
      this.problem('E_LOAD_FIELD_TYPE', this.child(path, 'on'), 'on must be a string or string array');
    }
    this.requiredEnum(value, 'phase', path, ['before', 'modify', 'instead', 'default', 'after']);
    if (value['when'] !== undefined) this.expr(value['when'], this.child(path, 'when'));
    this.requiredFiniteNumber(value, 'priority', path);
    const effects = this.requiredArray(value, 'effects', path);
    if (effects) this.effectArray(effects, this.child(path, 'effects'));
    this.optionalBoolean(value, 'once', path);
  }

  private attachmentDef(value: JsonObject, path: string): void {
    this.knownFields(value, this.withCommon(['stackStrategy', 'maxStack', 'aura', 'onAdd', 'onExpire', 'onRemove']), path);
    this.requiredEnum(value, 'stackStrategy', path, ['unique', 'refresh', 'count', 'independent']);
    this.optionalNonNegativeInteger(value, 'maxStack', path);
    const aura = this.optionalRecord(value, 'aura', path);
    if (aura) {
      const auraPath = this.child(path, 'aura');
      this.knownFields(aura, new Set(['deps', 'compute']), auraPath);
      this.requiredStringArray(aura, 'deps', auraPath);
      this.requiredExpr(aura, 'compute', auraPath);
    }
    for (const key of ['onAdd', 'onExpire', 'onRemove'] as const) {
      if (value[key] !== undefined) this.effectArray(value[key], this.child(path, key));
    }
  }

  private scheduleDef(value: JsonObject, path: string): void {
    this.knownFields(value, this.withCommon(['phases', 'loop', 'order', 'initiativeExpr', 'resolveOrder', 'onConflict', 'roundEnd']), path);
    const phases = this.requiredArray(value, 'phases', path);
    phases?.forEach((phase, index) => this.phase(phase, `${this.child(path, 'phases')}/${index}`));
    this.optionalBoolean(value, 'loop', path);
    this.optionalEnum(value, 'order', path, ['fixed', 'initiative']);
    if (value['initiativeExpr'] !== undefined) this.expr(value['initiativeExpr'], this.child(path, 'initiativeExpr'));
    if (value['resolveOrder'] !== undefined) this.expr(value['resolveOrder'], this.child(path, 'resolveOrder'));
    if (value['onConflict'] !== undefined) this.effectArray(value['onConflict'], this.child(path, 'onConflict'));
    if (value['roundEnd'] !== undefined) this.effectArray(value['roundEnd'], this.child(path, 'roundEnd'));
  }

  private phase(value: unknown, path: string): void {
    if (!this.record(value, path, 'schedule phase')) return;
    this.knownFields(value, new Set([
      'id', 'name', 'label', 'kind', 'phaseKind', 'actors', 'input',
      'reactionRounds', 'duration', 'timeLimit', 'onEnter', 'onExit', 'timeoutSeconds',
    ]), path);
    this.requiredString(value, 'id', path);
    this.optionalString(value, 'name', path);
    this.optionalString(value, 'label', path);
    this.optionalEnum(value, 'kind', path, ['action', 'response', 'cleanup', 'custom']);
    this.optionalEnum(value, 'phaseKind', path, ['normal', 'submit', 'resolve', 'response']);
    if (value['actors'] !== undefined) this.query(value['actors'], this.child(path, 'actors'));
    this.optionalEnum(value, 'input', path, ['none', 'actor', 'all']);
    this.optionalNonNegativeInteger(value, 'reactionRounds', path);
    if (value['duration'] !== undefined) this.expr(value['duration'], this.child(path, 'duration'));
    if (value['timeLimit'] !== undefined) this.expr(value['timeLimit'], this.child(path, 'timeLimit'));
    if (value['onEnter'] !== undefined) this.effectArray(value['onEnter'], this.child(path, 'onEnter'));
    if (value['onExit'] !== undefined) this.effectArray(value['onExit'], this.child(path, 'onExit'));
    this.optionalFiniteNumber(value, 'timeoutSeconds', path, 0);
  }

  private exprDef(value: JsonObject, path: string): void {
    this.knownFields(value, this.withCommon(['params', 'body', 'pure']), path);
    this.optionalStringArray(value, 'params', path);
    this.requiredExpr(value, 'body', path);
    if (value['pure'] === undefined) this.missing(path, 'pure');
    else if (value['pure'] !== true) this.problem('E_LOAD_CROSS_FIELD_CONSTRAINT', this.child(path, 'pure'), 'Named expression pure must be true');
  }

  private expr(value: unknown, path: string): value is Expr {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') {
      if (Number.isFinite(value)) return true;
      this.problem('E_INV_NAN_OR_INFINITY', path, 'Expression number must be finite');
      return false;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => this.expr(item, `${path}/${index}`));
      return true;
    }
    if (!isRecord(value)) {
      this.problem('E_EXPR_TYPE', path, 'Expression must be JSON data or a recognized expression object');
      return false;
    }

    const forms = EXPR_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(value, key));
    if (forms.length === 0) {
      for (const [key, child] of Object.entries(value)) this.expr(child, this.child(path, key));
      return true;
    }
    if (forms.length !== 1) {
      this.problem('E_EXPR_TYPE', path, 'Expression object must use exactly one of path, var, op, q, or call');
      return false;
    }
    switch (forms[0]) {
      case 'path':
        this.knownFields(value, new Set(['path']), path);
        return this.requiredString(value, 'path', path) !== undefined;
      case 'var':
        this.knownFields(value, new Set(['var']), path);
        return this.requiredString(value, 'var', path) !== undefined;
      case 'op': {
        this.knownFields(value, new Set(['op', 'args']), path);
        this.requiredString(value, 'op', path);
        const args = this.requiredArray(value, 'args', path);
        args?.forEach((arg, index) => this.expr(arg, `${this.child(path, 'args')}/${index}`));
        return args !== undefined;
      }
      case 'q':
        this.knownFields(value, new Set(['q']), path);
        return this.query(value['q'], this.child(path, 'q'));
      case 'call': {
        this.knownFields(value, new Set(['call', 'args']), path);
        this.requiredString(value, 'call', path);
        const args = this.optionalRecord(value, 'args', path);
        if (args) for (const [key, arg] of Object.entries(args)) this.expr(arg, this.child(this.child(path, 'args'), key));
        return true;
      }
    }
    return false;
  }

  private query(value: unknown, path: string): value is Query {
    if (!this.record(value, path, 'query')) return false;
    this.knownFields(value, new Set(['from', 'where', 'in', 'visibleTo', 'orderBy', 'desc', 'limit']), path);
    const from = this.requiredString(value, 'from', path);
    if (from !== undefined && !QUERY_FROM.has(from)) {
      this.problem('E_LOAD_CROSS_FIELD_CONSTRAINT', this.child(path, 'from'), `Unknown query source ${from}`);
    }
    for (const key of ['where', 'in', 'visibleTo', 'orderBy'] as const) {
      if (value[key] !== undefined) this.expr(value[key], this.child(path, key));
    }
    this.optionalBoolean(value, 'desc', path);
    this.optionalNonNegativeInteger(value, 'limit', path);
    return true;
  }

  private effectArray(value: unknown, path: string): value is JsonEffect[] {
    if (!Array.isArray(value)) {
      this.problem('E_LOAD_FIELD_TYPE', path, 'Effects must be an array');
      return false;
    }
    value.forEach((effect, index) => this.effect(effect, `${path}/${index}`));
    return true;
  }

  private effect(value: unknown, path: string): value is JsonEffect {
    if (!this.record(value, path, 'effect', 'E_FLOW_UNKNOWN_EFFECT')) return false;
    const forms = EFFECT_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(value, key));
    if (forms.length !== 1) {
      this.problem('E_FLOW_UNKNOWN_EFFECT', path, 'Effect must use exactly one recognized effect form');
      return false;
    }
    switch (forms[0]) {
      case 'op': {
        this.knownFields(value, new Set(['op', 'args', 'result']), path);
        this.requiredString(value, 'op', path);
        const args = this.requiredRecord(value, 'args', path);
        if (args) for (const [key, arg] of Object.entries(args)) this.expr(arg, this.child(this.child(path, 'args'), key));
        this.optionalString(value, 'result', path);
        return true;
      }
      case 'let':
        this.knownFields(value, new Set(['let', 'be']), path);
        this.requiredString(value, 'let', path);
        this.requiredExpr(value, 'be', path);
        return true;
      case 'if':
        this.knownFields(value, new Set(['if', 'then', 'else']), path);
        this.requiredExpr(value, 'if', path);
        this.requiredEffectArray(value, 'then', path);
        if (value['else'] !== undefined) this.effectArray(value['else'], this.child(path, 'else'));
        return true;
      case 'forEach':
        this.knownFields(value, new Set(['forEach', 'as', 'do']), path);
        this.requiredExpr(value, 'forEach', path);
        this.requiredString(value, 'as', path);
        this.requiredEffectArray(value, 'do', path);
        return true;
      case 'while':
        this.knownFields(value, new Set(['while', 'do', 'maxIter']), path);
        this.requiredExpr(value, 'while', path);
        this.requiredEffectArray(value, 'do', path);
        if (value['maxIter'] === undefined) {
          this.problem('E_FLOW_NO_MAXITER', this.child(path, 'maxIter'), 'while effect requires maxIter');
        } else {
          this.requiredNonNegativeInteger(value, 'maxIter', path);
        }
        return true;
      case 'emit':
        this.knownFields(value, new Set(['emit', 'data']), path);
        this.requiredString(value, 'emit', path);
        if (value['data'] !== undefined) this.expr(value['data'], this.child(path, 'data'));
        return true;
      case 'after':
        this.knownFields(value, new Set(['after', 'do']), path);
        this.requiredExpr(value, 'after', path);
        this.requiredEffectArray(value, 'do', path);
        return true;
      case 'at':
        this.knownFields(value, new Set(['at', 'do']), path);
        this.requiredExpr(value, 'at', path);
        this.requiredEffectArray(value, 'do', path);
        return true;
      case 'try':
        this.knownFields(value, new Set(['try', 'catch']), path);
        this.requiredEffectArray(value, 'try', path);
        if (value['catch'] !== undefined) this.effectArray(value['catch'], this.child(path, 'catch'));
        return true;
      case 'abort':
        this.knownFields(value, new Set(['abort']), path);
        this.requiredExpr(value, 'abort', path);
        return true;
    }
    return false;
  }

  private validateJsonSafety(value: unknown, path: string, ancestors: Set<object>): boolean {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') {
      if (Number.isFinite(value)) return true;
      this.problem('E_INV_NAN_OR_INFINITY', path, 'JSON number must be finite');
      return false;
    }
    if (typeof value !== 'object') {
      this.problem('E_INV_UNSUPPORTED_TYPE', path, 'Value is not JSON-safe');
      return false;
    }
    if (ancestors.has(value)) {
      this.problem('E_INV_UNSUPPORTED_TYPE', path, 'Cyclic object is not JSON-safe');
      return false;
    }
    ancestors.add(value);
    let valid = true;
    if (Array.isArray(value)) {
      value.forEach((child, index) => { if (!this.validateJsonSafety(child, `${path}/${index}`, ancestors)) valid = false; });
    } else {
      for (const [key, child] of Object.entries(value)) {
        if (!this.validateJsonSafety(child, this.child(path, key), ancestors)) valid = false;
      }
    }
    ancestors.delete(value);
    return valid;
  }

  private knownFields(value: JsonObject, allowed: ReadonlySet<string>, path: string): void {
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) this.problem('E_LOAD_UNKNOWN_FIELD', this.child(path, key), `Unknown field ${key}`);
    }
  }

  private withCommon(fields: readonly string[]): Set<string> {
    return new Set([...COMMON_DEF_FIELDS, ...fields]);
  }

  private record(value: unknown, path: string, label: string, code: ErrCode = 'E_LOAD_FIELD_TYPE'): value is JsonObject {
    if (isRecord(value)) return true;
    this.problem(code, path, `${label} must be an object`);
    return false;
  }

  private requiredRecord(value: JsonObject, key: string, path: string): JsonObject | undefined {
    if (value[key] === undefined) { this.missing(path, key); return undefined; }
    if (!isRecord(value[key])) { this.problem('E_LOAD_FIELD_TYPE', this.child(path, key), `${key} must be an object`); return undefined; }
    return value[key] as JsonObject;
  }

  private optionalRecord(value: JsonObject, key: string, path: string): JsonObject | undefined {
    if (value[key] === undefined) return undefined;
    if (!isRecord(value[key])) { this.problem('E_LOAD_FIELD_TYPE', this.child(path, key), `${key} must be an object`); return undefined; }
    return value[key] as JsonObject;
  }

  private requiredArray(value: JsonObject, key: string, path: string): unknown[] | undefined {
    if (value[key] === undefined) { this.missing(path, key); return undefined; }
    if (!Array.isArray(value[key])) { this.problem('E_LOAD_FIELD_TYPE', this.child(path, key), `${key} must be an array`); return undefined; }
    return value[key] as unknown[];
  }

  private optionalArray(value: JsonObject, key: string, path: string): unknown[] | undefined {
    if (value[key] === undefined) return undefined;
    if (!Array.isArray(value[key])) { this.problem('E_LOAD_FIELD_TYPE', this.child(path, key), `${key} must be an array`); return undefined; }
    return value[key] as unknown[];
  }

  private requiredString(value: JsonObject, key: string, path: string): string | undefined {
    if (value[key] === undefined) { this.missing(path, key); return undefined; }
    if (typeof value[key] !== 'string') { this.problem('E_LOAD_FIELD_TYPE', this.child(path, key), `${key} must be a string`); return undefined; }
    return value[key] as string;
  }

  private optionalString(value: JsonObject, key: string, path: string): string | undefined {
    if (value[key] === undefined) return undefined;
    if (typeof value[key] !== 'string') { this.problem('E_LOAD_FIELD_TYPE', this.child(path, key), `${key} must be a string`); return undefined; }
    return value[key] as string;
  }

  private requiredBoolean(value: JsonObject, key: string, path: string): boolean | undefined {
    if (value[key] === undefined) { this.missing(path, key); return undefined; }
    if (typeof value[key] !== 'boolean') { this.problem('E_LOAD_FIELD_TYPE', this.child(path, key), `${key} must be a boolean`); return undefined; }
    return value[key] as boolean;
  }

  private optionalBoolean(value: JsonObject, key: string, path: string): boolean | undefined {
    if (value[key] === undefined) return undefined;
    if (typeof value[key] !== 'boolean') { this.problem('E_LOAD_FIELD_TYPE', this.child(path, key), `${key} must be a boolean`); return undefined; }
    return value[key] as boolean;
  }

  private requiredStringArray(value: JsonObject, key: string, path: string): string[] | undefined {
    const array = this.requiredArray(value, key, path);
    if (!array) return undefined;
    let valid = true;
    array.forEach((item, index) => {
      if (typeof item !== 'string') { valid = false; this.problem('E_LOAD_FIELD_TYPE', `${this.child(path, key)}/${index}`, `${key} members must be strings`); }
    });
    return valid ? array as string[] : undefined;
  }

  private optionalStringArray(value: JsonObject, key: string, path: string): string[] | undefined {
    if (value[key] === undefined) return undefined;
    if (!Array.isArray(value[key])) { this.problem('E_LOAD_FIELD_TYPE', this.child(path, key), `${key} must be an array`); return undefined; }
    let valid = true;
    (value[key] as unknown[]).forEach((item, index) => {
      if (typeof item !== 'string') { valid = false; this.problem('E_LOAD_FIELD_TYPE', `${this.child(path, key)}/${index}`, `${key} members must be strings`); }
    });
    return valid ? value[key] as string[] : undefined;
  }

  private requiredEnum(value: JsonObject, key: string, path: string, choices: readonly string[]): string | undefined {
    const item = this.requiredString(value, key, path);
    if (item !== undefined && !choices.includes(item)) {
      this.problem('E_LOAD_CROSS_FIELD_CONSTRAINT', this.child(path, key), `${key} must be one of ${choices.join(', ')}`);
    }
    return item;
  }

  private optionalEnum(value: JsonObject, key: string, path: string, choices: readonly string[]): string | undefined {
    const item = this.optionalString(value, key, path);
    if (item !== undefined && !choices.includes(item)) {
      this.problem('E_LOAD_CROSS_FIELD_CONSTRAINT', this.child(path, key), `${key} must be one of ${choices.join(', ')}`);
    }
    return item;
  }

  private requiredFiniteNumber(value: JsonObject, key: string, path: string): number | undefined {
    if (value[key] === undefined) { this.missing(path, key); return undefined; }
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) {
      this.problem('E_LOAD_FIELD_TYPE', this.child(path, key), `${key} must be a finite number`);
      return undefined;
    }
    return value[key] as number;
  }

  private optionalFiniteNumber(value: JsonObject, key: string, path: string, minimum?: number): number | undefined {
    if (value[key] === undefined) return undefined;
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) {
      this.problem('E_LOAD_FIELD_TYPE', this.child(path, key), `${key} must be a finite number`);
      return undefined;
    }
    const number = value[key] as number;
    if (minimum !== undefined && number < minimum) {
      this.problem('E_LOAD_CROSS_FIELD_CONSTRAINT', this.child(path, key), `${key} must be at least ${minimum}`);
    }
    return number;
  }

  private requiredNonNegativeInteger(value: JsonObject, key: string, path: string): number | undefined {
    const number = this.requiredFiniteNumber(value, key, path);
    if (number !== undefined && (!Number.isSafeInteger(number) || number < 0)) {
      this.problem('E_LOAD_CROSS_FIELD_CONSTRAINT', this.child(path, key), `${key} must be a non-negative safe integer`);
    }
    return number;
  }

  private optionalNonNegativeInteger(value: JsonObject, key: string, path: string): number | undefined {
    const number = this.optionalFiniteNumber(value, key, path);
    if (number !== undefined && (!Number.isSafeInteger(number) || number < 0)) {
      this.problem('E_LOAD_CROSS_FIELD_CONSTRAINT', this.child(path, key), `${key} must be a non-negative safe integer`);
    }
    return number;
  }

  private requiredExpr(value: JsonObject, key: string, path: string): boolean {
    if (value[key] === undefined) { this.missing(path, key); return false; }
    return this.expr(value[key], this.child(path, key));
  }

  private requiredEffectArray(value: JsonObject, key: string, path: string): boolean {
    if (value[key] === undefined) { this.missing(path, key); return false; }
    return this.effectArray(value[key], this.child(path, key));
  }

  private missing(path: string, key: string): void {
    this.problem('E_LOAD_REQUIRED_FIELD', this.child(path, key), `Required field ${key} is missing`);
  }

  private problem(code: ErrCode, path: string, message: string): void {
    const source = this.location(path);
    const definitionId = this.definitionIdAt(path);
    this.diagnostics.push({
      code,
      severity: 'error',
      message,
      creatorMessage: message,
      hint: 'Correct the JSON value at the reported path and decode again.',
      actionableHint: 'Correct the JSON value at the reported path and decode again.',
      phase: 2,
      stage: code.startsWith('E_FLOW') ? 'semantic' : 'schema',
      scope: definitionId ? 'definition' : 'document',
      path,
      source,
      sourceSpan: source.span,
      sourcePackage: source.sourcePackage,
      at: definitionId ? { def: definitionId, field: path } : { field: path },
    });
  }

  private definitionIdAt(path: string): string | undefined {
    let current: unknown = this.document.value;
    let definitionId: string | undefined;
    let previous = '';
    for (const encoded of path.split('/').slice(1)) {
      const segment = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
      if (Array.isArray(current)) {
        current = /^\d+$/.test(segment) ? current[Number(segment)] : undefined;
      } else if (isRecord(current)) {
        current = current[segment];
      } else {
        break;
      }
      if (previous === 'defs' && isRecord(current) && typeof current['id'] === 'string') {
        definitionId = current['id'];
      }
      previous = segment;
    }
    return definitionId;
  }

  private location(path: string) {
    let candidate = path;
    while (true) {
      const exact = this.document.locations.get(candidate);
      if (exact) return exact;
      if (candidate === '') return this.document.source;
      const slash = candidate.lastIndexOf('/');
      candidate = slash <= 0 ? '' : candidate.slice(0, slash);
    }
  }

  private child(parent: string, segment: string): string {
    return `${parent}/${segment.replace(/~/g, '~0').replace(/\//g, '~1')}`;
  }
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Keep imports tied to the public contract under isolatedModules; this assignment has no runtime cost.
type _JsonValueCompatibility = JsonValue;
type _DefCompatibility = Def;
