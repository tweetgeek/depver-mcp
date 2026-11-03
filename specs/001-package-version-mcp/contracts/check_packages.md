# Tool Contract: `check_packages`

**Feature**: [spec.md](../spec.md) | **Data model**: [data-model.md](../data-model.md)

The server exposes exactly one MCP tool. This file is the normative description of its input and
output; the implementation's zod schema and the README must match it.

## Tool metadata

| Field | Value |
|-------|-------|
| `name` | `check_packages` |
| `title` | Check package versions |
| `description` | Verify that packages exist and get their current versions from public registries (npm, PyPI, pub.dev, Packagist). Use before writing or updating a dependency manifest instead of guessing versions. Accepts up to 100 packages from mixed ecosystems in one call. Pass `version` to check an exact version or resolve a range. |
| `annotations` | `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: true` (it reaches external registries) |

## Input schema

```json
{
  "type": "object",
  "properties": {
    "packages": {
      "type": "array",
      "minItems": 1,
      "maxItems": 100,
      "items": {
        "type": "object",
        "properties": {
          "ecosystem": {
            "type": "string",
            "description": "npm | pypi | pub | packagist, or an alias: pnpm, yarn, node, pip, python, uv, poetry, dart, flutter, composer, php"
          },
          "name": {
            "type": "string",
            "minLength": 1,
            "description": "Package name as used by the package manager, e.g. react, @types/node, requests, http, laravel/framework"
          },
          "version": {
            "type": "string",
            "description": "Optional. An exact version (18.2.0) or a range in the ecosystem's native syntax (^18, >=2.0,<3, ~2.0)"
          }
        },
        "required": ["ecosystem", "name"],
        "additionalProperties": false
      }
    }
  },
  "required": ["packages"],
  "additionalProperties": false
}
```

Validation failures of the envelope (missing `packages`, 0 or more than 100 items, non-string
fields) reject the whole call with an MCP tool error whose text names the rule that failed, e.g.
`packages must contain between 1 and 100 items (got 101)`.

Per-item problems (unknown ecosystem, empty or syntactically invalid name, unparseable range) never
reject the call; they produce `s: "error"` for that item.

## Output

The tool returns one `text` content block containing a single JSON object, minified (no
whitespace), with the key `results` holding an array in the same order as the input.

```json
{"results":[<PackageResult>, ...]}
```

`PackageResult` keys and presence rules are defined in [data-model.md](../data-model.md#packageresult-output-item). No `structuredContent` is returned in the MVP; the text block is the contract (Constitution I: one copy of the data, not two).

### Examples

Request:

```json
{"packages":[
  {"ecosystem":"npm","name":"react"},
  {"ecosystem":"yarn","name":"request"},
  {"ecosystem":"pip","name":"Requests","version":"2.31.0"},
  {"ecosystem":"pypi","name":"requests","version":">=2.0,<2.20"},
  {"ecosystem":"dart","name":"http","version":"^1.0.0"},
  {"ecosystem":"composer","name":"laravel/framework","version":"~10.0"},
  {"ecosystem":"pub","name":"htttp"},
  {"ecosystem":"npm","name":"left-pad","version":"1.3.0"},
  {"ecosystem":"cargo","name":"serde"}
]}
```

Response (values illustrative; `e`, `n`, `s` and key presence are normative):

```json
{"results":[
{"e":"npm","n":"react","s":"ok","stable":"19.2.0","latest":"19.2.0"},
{"e":"npm","n":"request","s":"deprecated","stable":"2.88.2","latest":"2.88.2","msg":"request has been deprecated, see https://github.com/request/request/issues/3142"},
{"e":"pypi","n":"requests","s":"ok","stable":"2.32.5","latest":"2.32.5","v":"2.31.0","v_exists":true,"v_yanked":false},
{"e":"pypi","n":"requests","s":"ok","stable":"2.32.5","latest":"2.32.5","v":">=2.0,<2.20","v_match":"2.19.1"},
{"e":"pub","n":"http","s":"ok","stable":"1.5.0","latest":"1.5.0","v":"^1.0.0","v_match":"1.5.0"},
{"e":"packagist","n":"laravel/framework","s":"ok","stable":"12.30.1","latest":"12.30.1","v":"~10.0","v_match":"10.48.29"},
{"e":"pub","n":"htttp","s":"not_found"},
{"e":"npm","n":"left-pad","s":"deprecated","stable":"1.3.0","latest":"1.3.0","v":"1.3.0","v_exists":true,"v_deprecated":true,"msg":"use String.prototype.padStart()"},
{"e":"cargo","n":"serde","s":"error","msg":"unknown ecosystem; supported: npm, pypi, pub, packagist"}
]}
```

Nothing-installable examples:

```json
{"e":"npm","n":"unpublish-me","s":"not_found","msg":"unpublished from npm"}
{"e":"pypi","n":"all-yanked-example","s":"ok","msg":"all versions yanked"}
```

Timeout example:

```json
{"e":"packagist","n":"symfony/symfony","s":"error","msg":"registry timeout after 8000 ms"}
```

## Behavioural guarantees

- Order: `results[i]` answers `packages[i]`.
- Independence: any item may be `error` while its neighbours succeed.
- Idempotence: repeating a call within the cache window returns identical results without new registry traffic.
- Bound: the call returns within `per-item timeout + scheduling slack`, never waiting on a hung registry beyond the timeout.
- Size: a single result with no version check is at most 120 characters for typical names; a 100-item batch stays under 12 KB (SC-005).

## Error text (whole-call failures)

Only envelope validation fails the call. Messages are English, one sentence, no stack traces:

- `packages must contain between 1 and 100 items (got N)`
- `packages[N].name must be a non-empty string`
- `packages[N].ecosystem must be a string`
