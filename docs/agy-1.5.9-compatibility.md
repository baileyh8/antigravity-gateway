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
