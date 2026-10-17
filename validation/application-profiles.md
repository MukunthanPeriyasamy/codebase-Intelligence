# Application-aware documentation

Implemented sequence: repository-relative filtering, audited inventory, package
boundaries, deterministic profiles, composable requirements, bounded profile
evidence pages, source-grounded narrative generation, coverage gates and cache
fingerprint validation. No analyzed code is executed.

Profiles: Flutter, React, Next.js, FastAPI, AI integration, RAG candidates and
database integration. Unknown stacks retain common source/function references.
Versioned rules store file/line evidence. Confirmed means import and use-site
syntax coexist, not proof of runtime activation. Dependency-only evidence remains
candidate. Python uses AST imports/calls; Dart/JS/TS use lexical rules that can
miss aliases. RAG remains candidate because cross-call connectivity is unresolved.

package.json, pubspec.yaml, pyproject.toml and requirements.txt have dependency
readers. Cargo/go/Maven/Gradle manifests establish package boundaries only.
Rules are extensible, not exhaustive. Selected reads are bounded to 1 MB/file.
Generated directories and links are skipped; excluded paths are audited without
reading contents. Invalid manifests, unreadable files and parser gaps are reported.

Fingerprints include rule version, paths, statuses and readable content hashes.
Generation requests recompute detection before reusing cached wikis; legacy
caches without reports regenerate. Chat retains its document-first boundary.
Narrative pages use only declared source references. Zero readable files fails
before inference; failed/over-budget pages prevent publication as a complete wiki.
These checks establish evidence availability, not semantic correctness.

The supplied Quizzer export reports zero readable files. We reproduced a related
bug: absolute-path exclusion matching could exclude an entire checkout located
under a parent folder named tmp. Filtering is now repository-relative. The
original runtime settings are unavailable, so this is a plausible cause rather
than a confirmed diagnosis of that specific run.

Tests cover mixed packages, candidates, comments, unknown syntax, invalid
manifests, generated output, zero coverage, fingerprints, parent-folder filtering
and real-source generation fixtures. Live Quizzer model quality is unverified.
