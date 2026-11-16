# AGY CLI 1.5.9 compatibility

The maintenance fork retains its separate manager, Chat Completions endpoint,
quota/concurrency policies and Hydrogen signature protections while adopting
selected protocol and tool-contract improvements from LeeFeee's gateway 2.0.5.

## Captured transport

Unmodified CLI 1.5.9 was exercised against synthetic, loopback-only endpoints
on macOS arm64 and Linux x64. Model RPCs advertise only HTTP/1.1 and streaming
requests use chunked framing. The observed build is `1021519450`.
TLS 1.2, TLS 1.3, HelloRetryRequest and forced connection closure were captured.
Normalizing only random/session/key-share/PSK bytes, the Go 1.27.2 rebuild matched
the observed ClientHello structures on both platforms. This is a bounded runtime
comparison, not a claim of identical source builds or all-platform equivalence.

The CLI exposed both HTTP/1.1 and HTTP/2 OAuth refresh stacks. The gateway uses
one necessary refresh through its separately selected OAuth HTTP/2 profile;
it does not reproduce duplicate refresh activity. Both observed handshake
profiles are retained in the synthetic transport evidence. Token forms use
Content-Length; model streaming uses chunked framing.

## Model parameters

The model fixture includes only cases where the actual generated model ID
matched the requested ID. CLI alias fallback and the image-model case that did
not complete are not counted as model-specific acceptance. Profiles reflect a
synthetic catalog, not the entitlements of any production consumer account.
Hydrogen XHigh retains numeric thinkingLevel `100`. Client business parameters
are never recursively treated as generation settings.

## Verification boundaries

Offline transport and model captures consume no real account quota. Production
acceptance, deployed version and client round trips are recorded separately in
release notes after their respective gates complete.

## Tool contract and resource limits

Simple object contracts use direct fields. Complex schemas, arbitrary JSON roots,
namespace collisions, custom text/patch inputs and business metadata names keep
lossless compatibility views and are validated against the original contract.
File-native views require exact captured declarations and equivalent semantics;
commands, timeouts, approval modes and background behavior remain client-owned.
Receipts correlate with an actual submitted call ID/name; only structured tool
references are remapped. Never rewrite arbitrary user text by tool-name search.

All HTTP/schema effects use asynchronous bounded validation: one worker, 32
waiting jobs, 8 MiB queued payloads, 64 MiB old-generation limit, 30-second idle
retirement. Validation has bounded deadlines/cancellation; capacity and conversion
errors cannot cause account cooldown or cross-account retries. Offline fixture
wrappers remain synchronous; the HTTP scope rejects accidental sync fallback.

The fork migrates validated, account/session-owned `.24` v1 cache files to v2.
Only exact historical projections restore signatures and original calls; already
issued MCP aliases remain declared compatibility views. Unsigned restored steps
receive the existing Hydrogen marker only at final egress. No signature is derived
from a tool ID, arguments or another account. Account-store ownership guards and
all existing scheduling/manager configuration remain independent of this layer.

The legacy adapter is an explicit short-term fallback, not the default. Claude
server-managed tool review/search orchestration is outside this port. No transport
or prompt compatibility claim establishes reduced enforcement risk.
