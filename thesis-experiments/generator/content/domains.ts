// Topic domains for the scenarios. Each domain has one forced-choice "slot"
// (the required fact), seven interchangeable options for it, neutral Q/A
// exchanges used as filler, and templates for each sibling type.
//
// Placeholders: {value} = the active-path (correct) option,
// {alt} = a conflicting option, {c:KIND} = a fresh random canary of KIND
// (ident | port | hex | ver). Every {c:...} must appear in exactly ONE
// message of a template pair, so each canary occurs exactly once.
//
// Filler text must never contain any option name; the validator enforces it.

export interface Exchange { user: string; assistant: string }

export interface Domain {
  id: string;
  slot: string;                // human description of the required fact
  options: string[];           // >= 7, distinct, no option inside another
  intro: string;               // prefixed to the root user message
  fact: Exchange;              // states {value} on the active path
  question: string;            // final question, must not contain an option
  qa: Exchange[];              // neutral filler exchanges
  consistent: Exchange[];      // variants; true extra detail + canary
  misleading: Exchange[];      // variants; plausible false claim + canary
  conflicting: Exchange[];     // variants; {alt} decision + canary
}

export const DOMAINS: Domain[] = [
  {
    id: 'db',
    slot: 'primary key type for the users table',
    options: ['uuid', 'bigserial', 'ulid', 'ksuid', 'cuid2', 'snowflake', 'nanoid'],
    intro: "I'm designing the Postgres schema for a small invoicing app and want to think the tables through before writing migrations.",
    fact: {
      user: "For the primary key type on the users table, let's go with {value}.",
      assistant: 'Good, {value} for the users table primary key. It gives every row a stable identifier that we can expose in URLs and reference from other tables.'
    },
    question: 'Quick check before I write the migration: which primary key type did we settle on for the users table? Give me the column definition line for it.',
    qa: [
      { user: 'How should we handle soft deletes for invoices?', assistant: 'Add a nullable deleted_at column and filter on it in the default queries. A partial index on rows where it is null keeps the common lookups fast.' },
      { user: 'Should line items live in their own table or in a JSON column?', assistant: 'Give line items their own table with a foreign key to the invoice. You will want to sum, filter and report on them, and that is painful inside JSON.' },
      { user: 'What indexes do we need for the invoice search page?', assistant: 'Index the workspace and status together, plus the issue date for sorting. Add a trigram index on the customer name only if search by name turns out to be slow.' },
      { user: 'How do we store money amounts without rounding problems?', assistant: 'Store amounts as whole cents in a numeric column and keep the currency code next to it. Do the formatting in the application, never in the database.' },
      { user: 'Should we keep an audit log of changes to invoices?', assistant: 'Yes, an append-only table with the actor, the action and a diff of the changed fields is enough. Write to it in the same transaction as the change.' },
      { user: 'How should we model customers that belong to more than one workspace?', assistant: 'Use a join table between customers and workspaces with its own created date. That keeps the customer record single while letting each workspace hold its own settings.' },
      { user: 'What is the cleanest way to number invoices per workspace?', assistant: 'Keep a counter row per workspace and increment it inside the insert transaction. Gaps are acceptable, duplicates are not, so lock the counter row while you increment.' },
      { user: 'Do we need a separate table for payment attempts?', assistant: 'Yes, record every attempt with its provider response and outcome. The invoice then only stores the final paid state, which keeps it simple to query.' },
      { user: 'How should we handle dates and times in the schema?', assistant: 'Store every instant in UTC with a time zone aware column and convert only at the edges. Due dates are calendar dates, so those can be plain date columns.' },
      { user: 'What constraints should we put on the email column?', assistant: 'Make it not null, store it lowercased, and add a unique index per workspace. A check constraint for a basic shape is fine, but leave real validation to the app.' }
    ],
    consistent: [
      { user: 'If we stick with {value} keys, how should we generate them?', assistant: 'With {value} keys, generate them in the database with a column default so every insert path gets one, and name the column `{c:ident}` so it is clear it is the external id.' },
      { user: 'Where should the {value} values be generated, in the app or the database?', assistant: 'Generate {value} values in the database default and expose them through a view named `{c:ident}` that the API reads from.' }
    ],
    misleading: [
      { user: 'I read that since Postgres {c:ver}, {value} keys have to be declared through a special domain type or inserts get slow. Is that right?', assistant: 'Yes, that matches the release notes, so the migration should declare the key through that domain type to stay on the fast path.' },
      { user: 'A blog post said {value} keys need the `{c:ident}` extension in Postgres, otherwise inserts lock the whole table. Do we need it?', assistant: 'Yes, install that extension in the first migration so inserts do not take table locks.' }
    ],
    conflicting: [
      { user: 'What if we used {alt} for the users table primary key instead?', assistant: "{alt} would work here. I'd define it with a column default and keep the generator in a helper named `{c:ident}` so the app code stays consistent." },
      { user: 'Would {alt} keys be a better fit for the users table?', assistant: "{alt} keys could be a better fit. I'd generate them in a function called `{c:ident}` and use it as the column default." }
    ]
  },
  {
    id: 'http',
    slot: 'HTTP client library for the Node service',
    options: ['undici', 'axios', 'ky', 'superagent', 'ofetch', 'wretch', 'phin'],
    intro: "I'm writing a Node service that calls three partner APIs, and I want to settle the networking layer before the code spreads.",
    fact: {
      user: "For the HTTP client library, let's use {value}.",
      assistant: '{value} it is for outgoing requests. We can wrap it in one small module so retries and headers live in a single place.'
    },
    question: 'Before I wire up the partner calls: which HTTP client library did we pick for the Node service? Show me the import line I should use.',
    qa: [
      { user: 'How should we handle retries for the partner calls?', assistant: 'Retry only idempotent requests, with exponential backoff and jitter, and cap it at three attempts. Anything that creates data on the partner side should not be retried blindly.' },
      { user: 'What timeouts make sense per partner?', assistant: 'Set a connect timeout and a total timeout separately for each partner. Start from their documented latency and add a margin rather than using one global number.' },
      { user: 'Should we log request and response bodies?', assistant: 'Log method, URL, status and duration for every call, but bodies only at debug level and with secrets redacted. Partner payloads often carry personal data.' },
      { user: 'How do we rotate the partner API tokens without downtime?', assistant: 'Load tokens from the secret store at request time with a short cache. Then a rotation only needs both tokens valid for a few minutes.' },
      { user: 'How should we react to 429 responses?', assistant: 'Respect the Retry-After header when it is present and back off when it is not. Track the rate per partner so one noisy integration does not starve the others.' },
      { user: 'How do we test the partner calls without hitting the real APIs?', assistant: 'Record a few real responses as fixtures and serve them from a local mock server in tests. Contract tests against the sandbox can run nightly instead of on every push.' },
      { user: 'Do we need a circuit breaker?', assistant: 'For the partner with the worst uptime, yes. Open the breaker after a run of failures and serve a cached or degraded response while it is open.' },
      { user: 'Should we reuse connections between requests?', assistant: 'Yes, keep-alive with a bounded pool per partner host saves a lot of handshake time. Make the pool size configurable so we can tune it under load.' },
      { user: 'How should we handle malformed JSON from a partner?', assistant: 'Parse inside a try block and treat a parse failure like a server error with the raw body attached to the log. Never let it crash the request handler.' },
      { user: 'Do we need idempotency keys on the payment partner calls?', assistant: 'Yes, generate one per logical operation and send it on every retry. That way a timeout followed by a retry cannot charge a customer twice.' }
    ],
    consistent: [
      { user: "Since we're using {value}, where should the shared settings live?", assistant: 'Put the shared {value} instance in one module and give it a default timeout of {c:port} milliseconds, which matches what the slowest partner documents.' },
      { user: 'With {value}, what user agent should we send?', assistant: 'Send a user agent like `{c:ident}` from the shared {value} instance so partners can identify our traffic in their logs.' }
    ],
    misleading: [
      { user: 'Someone on the team said {value} drops request bodies above a size limit unless you set the `{c:ident}` option. Is that a known thing?', assistant: 'Yes, that is a known behavior, so set that option on the shared instance before sending large payloads.' },
      { user: 'I read that {value} caps concurrent sockets at {c:port} per host and silently queues the rest. Do we need to change that?', assistant: 'Yes, that limit would explain queued requests, so raise it in the shared configuration.' }
    ],
    conflicting: [
      { user: 'What if we used {alt} as the HTTP client instead?', assistant: "{alt} would also fit. I'd create one shared instance called `{c:ident}` and import it everywhere so the configuration stays in one place." },
      { user: 'Is {alt} a better HTTP client for this service?', assistant: "{alt} is a good option here. I'd wrap it in a module named `{c:ident}` that every partner client imports." }
    ]
  },
  {
    id: 'cache',
    slot: 'eviction policy for the product cache',
    options: ['LRU', 'LFU', 'FIFO', 'ARC', 'SLRU', '2Q', 'MRU'],
    intro: 'Our product catalog API is slow under load, so I want to put an in-process cache in front of the database.',
    fact: {
      user: "For the eviction policy on the product cache, let's go with {value}.",
      assistant: '{value} is a reasonable fit for the catalog. We can cap the cache by entry count and revisit the size after watching hit rates.'
    },
    question: "I'm about to write the cache setup: which eviction policy did we choose for the product cache? Give me the config line that sets it.",
    qa: [
      { user: 'What should the cache key look like?', assistant: 'Use the product id plus the region and currency of the request. Put a version prefix in front so a format change can invalidate everything at once.' },
      { user: 'How long should entries live?', assistant: 'Give entries a time to live of a few minutes as a safety net even with eviction in place. Price changes should also invalidate the affected keys directly.' },
      { user: 'How do we invalidate when a product changes?', assistant: 'Publish a change notice from the admin service and delete the matching keys on every instance. The time to live covers any notice that gets lost.' },
      { user: 'What about the thundering herd when a hot key expires?', assistant: 'Let one request rebuild the entry while the others wait on the same promise. Serving the stale value during the rebuild is fine for catalog data.' },
      { user: 'Should the cache be per instance or shared?', assistant: 'Start per instance since it needs no new infrastructure. If the hit rate suffers as we scale out, add a shared layer behind it later.' },
      { user: 'How do we measure whether the cache helps?', assistant: 'Export hit rate, miss rate and eviction count as metrics. Compare the p95 latency of the catalog endpoint before and after turning it on.' },
      { user: 'Should we cache negative lookups for missing products?', assistant: 'Yes, but with a much shorter lifetime than real entries. That blocks repeated scans for ids that do not exist without hiding new products for long.' },
      { user: 'How much memory can we give the cache?', assistant: 'Leave enough headroom for the rest of the process under peak load. Measure the average entry size first and set the limit from that instead of guessing.' },
      { user: 'Do we need to warm the cache on deploy?', assistant: 'Warming the top few hundred products on startup avoids a slow first minute after each deploy. Keep it bounded so startup stays quick.' },
      { user: 'What happens to the cache when an instance restarts?', assistant: 'It starts empty, so expect a short burst of database reads. That is acceptable as long as the instances do not all restart at the same moment.' }
    ],
    consistent: [
      { user: 'With {value} eviction, how big should the cache be?', assistant: "With {value}, start with a cap of {c:port} entries, which covers the hot part of the catalog based on last month's traffic." },
      { user: 'With {value}, how often should we log cache stats?', assistant: 'With {value}, emit a stats line every {c:port} requests so we can watch evictions without flooding the logs.' }
    ],
    misleading: [
      { user: 'I read that {value} caches leak memory in Node unless you enable the `{c:ident}` flag at startup. Should we do that?', assistant: 'Yes, enable that flag when the service boots so the cache stays within its memory budget.' },
      { user: 'Someone said {value} eviction falls back to random eviction past {c:port} entries unless the size is a power of two. True?', assistant: 'Yes, so size the cache to a power of two to keep the policy in effect.' }
    ],
    conflicting: [
      { user: 'What if we used {alt} for the product cache eviction instead?', assistant: "{alt} could work too. I'd put the policy behind a setting called `{c:ident}` so we can switch it without a deploy." },
      { user: 'Would {alt} eviction suit the catalog better?', assistant: "{alt} eviction suits read-heavy catalogs well. I'd expose it through a config flag `{c:ident}` so we can compare policies." }
    ]
  },
  {
    id: 'flaky',
    slot: 'root cause tag of the flaky checkout test',
    options: ['timezone', 'locale', 'unseeded-random', 'shared-fixture', 'port-collision', 'stale-snapshot', 'mock-leak'],
    intro: 'Our checkout integration test fails maybe one run in ten on CI and never locally, and I want to track it down properly.',
    fact: {
      user: 'I dug through the failing runs and tagged the root cause as `{value}`.',
      assistant: 'That fits the pattern of failures. With the root cause tagged as `{value}`, we can write a targeted fix and add a guard so it does not come back.'
    },
    question: 'For the postmortem note: what root cause did we tag for the flaky checkout test? Write the one-line summary I should put in the ticket.',
    qa: [
      { user: 'How do we reproduce the failure locally?', assistant: 'Run the test in a loop with the same parallelism as CI until it fails, and save the logs from the failing run. Matching the CI environment variables matters more than matching the hardware.' },
      { user: 'Should we just add a retry to the test?', assistant: 'A retry hides the problem and makes the next flake harder to find. Keep the test failing until we understand it, but quarantine it so it does not block merges.' },
      { user: 'What should we capture from the failing CI runs?', assistant: 'Keep the full log, the order the tests ran in, and a dump of the database state at the failure. Those three usually point straight at the cause.' },
      { user: 'Could the test order matter?', assistant: 'It can, so run the suite in a shuffled order a few times. If the failure only shows up after one particular test, that test is leaving something behind.' },
      { user: 'How do we stop new flaky tests from creeping in?', assistant: 'Track pass rates per test over the last few hundred runs and flag anything below a threshold. Make the owner fix it within a week or delete it.' },
      { user: 'Should the checkout test talk to the real payment sandbox?', assistant: 'Not in the main suite; stub the payment client at the boundary. Keep one separate nightly job that exercises the real sandbox.' },
      { user: 'How do we make the test less dependent on wall clock time?', assistant: 'Inject a clock into the checkout code and freeze it in the test. Asserting on durations measured with the real clock is a common source of intermittent failures.' },
      { user: 'What does the CI runner setup look like compared to local?', assistant: 'CI runs four workers in containers with fewer cores and a different base image. Those differences are worth listing next to the failure pattern.' },
      { user: 'Should we write up a postmortem for a flaky test?', assistant: 'A short one is worth it: the symptom, the cause, the fix and how we will catch it next time. It saves the next person a day of digging.' },
      { user: 'How do we confirm the fix actually worked?', assistant: 'Run the test a few hundred times in CI with the fix and compare against the old failure rate. One green run proves nothing for a one-in-ten flake.' }
    ],
    consistent: [
      { user: 'Given the `{value}` cause, how should the fix look?', assistant: 'Fix it in the test setup and add a regression check named `{c:ident}` so the suite fails loudly if the `{value}` problem comes back.' },
      { user: 'Should we document the `{value}` cause somewhere?', assistant: 'Add it to the flaky-test log under the entry `{c:ident}` with the failing run attached, so it is searchable later.' }
    ],
    misleading: [
      { user: 'A teammate says CI runners on image version {c:ver} are known to make checkout tests flaky regardless of the code. Should we just pin the image?', assistant: 'That sounds right; pinning the runner image to an older version should stop the flakiness without code changes.' },
      { user: 'I read that our test framework has a known bug where the `{c:ident}` reporter fails checkout tests at random. Is that our problem?', assistant: 'That is likely the culprit, so disabling that reporter should fix the flakiness without other changes.' }
    ],
    conflicting: [
      { user: 'What if the root cause is actually `{alt}`?', assistant: "If it is `{alt}`, I'd tag it that way and add a check called `{c:ident}` that reproduces it locally." },
      { user: 'Could `{alt}` explain the failures better?', assistant: "`{alt}` would explain the pattern too. I'd add a reproduction script called `{c:ident}` to confirm it." }
    ]
  },
  {
    id: 'queue',
    slot: 'message broker for the order events',
    options: ['RabbitMQ', 'Kafka', 'NATS', 'SQS', 'BullMQ', 'Pulsar', 'ZeroMQ'],
    intro: 'We are splitting order processing out of the monolith and need a way to publish order events to the new services.',
    fact: {
      user: "For the message broker for order events, let's use {value}.",
      assistant: '{value} works for the order events. We should define the event schema first so producers and consumers agree on the payload.'
    },
    question: "I'm writing the producer now: which message broker did we pick for the order events? Give me the one-line connection setup.",
    qa: [
      { user: 'What should the order event payload contain?', assistant: 'Include the order id, the event type, a version number, and the fields consumers need right now. Avoid sending the whole order object, or every schema change becomes a breaking change.' },
      { user: 'How do we make consumers safe against duplicate deliveries?', assistant: 'Store the ids of processed events and skip any event you have already handled. At-least-once delivery means duplicates will happen eventually.' },
      { user: 'Do we need ordering guarantees?', assistant: 'Only per order, not globally. Route events for the same order to the same partition or group so they arrive in sequence.' },
      { user: 'What happens when a consumer keeps failing on one event?', assistant: 'After a few retries, move the event to a dead-letter destination and alert. Do not let one bad event block everything behind it.' },
      { user: 'How do we publish events reliably from the monolith?', assistant: 'Use an outbox table written in the same transaction as the order change, and a relay that publishes from it. That avoids losing events when the publish fails after the commit.' },
      { user: 'How should we version the event schema?', assistant: 'Add a version field and only make additive changes within a version. For breaking changes, publish both versions for a while and migrate consumers one at a time.' },
      { user: 'How do we monitor the pipeline?', assistant: 'Track consumer lag, publish rate and the dead-letter count. Alert on lag growing for more than a few minutes rather than on single spikes.' },
      { user: 'Should the analytics team consume the same events?', assistant: 'Yes, through their own consumer group so their slow batch jobs never hold up order processing. They get the same stream without coupling to our services.' },
      { user: 'How do we replay events after a bug?', assistant: 'Keep events for at least a week and make consumers able to restart from an earlier position. Replays then become a routine operation instead of an emergency.' },
      { user: 'How do we test the consumers?', assistant: 'Unit test the handler with plain event objects and run one integration test against a local broker in a container. That covers both the logic and the wiring.' }
    ],
    consistent: [
      { user: 'With {value}, what should we name things?', assistant: 'With {value}, name the main order topic `{c:ident}` and keep one dead-letter destination per consumer.' },
      { user: 'With {value}, how should consumer groups be named?', assistant: 'Name the order consumer group `{c:ident}` so it is obvious in dashboards which service it belongs to.' }
    ],
    misleading: [
      { user: 'I heard {value} silently drops messages larger than {c:port} bytes unless you split them. Is that true?', assistant: 'Yes, so we should split large order payloads before publishing to stay under that limit.' },
      { user: 'Someone said {value} needs the `{c:ident}` setting turned on or it reorders events for the same key. Is that right?', assistant: 'Yes, turn that setting on in the client config, or per-order ordering is not guaranteed.' }
    ],
    conflicting: [
      { user: 'What if we used {alt} for the order events instead?', assistant: "{alt} would also handle this. I'd name the main order channel `{c:ident}` and keep consumers idempotent either way." },
      { user: 'Would {alt} suit the order events better?', assistant: "{alt} suits this kind of event stream. I'd call the order stream `{c:ident}` and add an outbox in front of it." }
    ]
  },
  {
    id: 'auth',
    slot: 'password hashing algorithm for user accounts',
    options: ['argon2id', 'bcrypt', 'scrypt', 'pbkdf2', 'yescrypt', 'balloon', 'sha512crypt'],
    intro: "I'm building the sign-up and login flow for a small SaaS app and want to get the password storage right from day one.",
    fact: {
      user: "For the password hashing algorithm, let's go with {value}.",
      assistant: '{value} is a solid choice for stored passwords. We should keep the cost parameters in config so we can raise them later.'
    },
    question: 'Before I write the signup handler: which password hashing algorithm did we decide on? Give me the line that hashes the password.',
    qa: [
      { user: 'What password length limits should we enforce?', assistant: 'Require at least twelve characters and allow long passphrases up to a generous limit. Do not impose composition rules; check against a list of breached passwords instead.' },
      { user: 'How should we handle login rate limiting?', assistant: 'Limit attempts per account and per IP separately, with increasing delays. Lock nothing permanently, since that lets attackers lock out real users.' },
      { user: 'What should the password reset flow look like?', assistant: 'Send a single-use token that expires within an hour, and store only a hash of it. Invalidate existing sessions once the password changes.' },
      { user: 'Should we support passkeys from the start?', assistant: 'Design the accounts table so a user can have several credentials, even if passkeys come later. Retrofitting that is harder than planning for it.' },
      { user: 'How do we compare hashes safely?', assistant: "Use the library's verify function, which compares in constant time. Never compare hash strings with plain equality in your own code." },
      { user: 'Where should the session tokens live in the browser?', assistant: 'Use an HTTP-only, secure, same-site cookie. Keep tokens out of anything JavaScript can read.' },
      { user: 'How do we upgrade the hashing cost later?', assistant: 'Store the parameters with each hash and check them at login. If they are older than the current setting, rehash the password while you still have it in memory.' },
      { user: 'Should we add two-factor authentication now?', assistant: 'Offer authenticator-app codes as optional now and make it required for admin accounts. SMS codes can come later if customers ask.' },
      { user: 'How do we avoid leaking which emails are registered?', assistant: 'Return the same message and similar timing for unknown emails on login and reset. Send the actual details only by email.' },
      { user: 'What should we log around authentication?', assistant: 'Log successes, failures and resets with the account id and IP, never the password or the token. Those logs are what you need when investigating a takeover.' }
    ],
    consistent: [
      { user: 'Using {value}, how should we store the hashes?', assistant: 'Store the full {value} hash string in a column called `{c:ident}`; it already carries the salt and parameters.' },
      { user: 'With {value}, where should the cost parameters live?', assistant: 'Keep them in config under a key named `{c:ident}` so we can raise the cost later without a code change.' }
    ],
    misleading: [
      { user: 'I read that the latest OWASP guidance requires a pepper in an env var named `{c:ident}` when using {value}, or audits fail. Is that right?', assistant: 'Right, add that env var and read it at startup before hashing anything.' },
      { user: 'I read that {value} silently truncates passwords longer than {c:port} characters. Is that a thing?', assistant: 'Yes, so cap passwords below that length in the signup form.' }
    ],
    conflicting: [
      { user: 'What if we used {alt} for password hashing instead?', assistant: "{alt} is also defensible. I'd wrap it in a helper called `{c:ident}` so the rest of the code never calls the library directly." },
      { user: 'Is {alt} a better choice for password hashing?', assistant: "{alt} is a reasonable choice. I'd put it behind a function `{c:ident}` so swapping algorithms later only touches one file." }
    ]
  }
];
