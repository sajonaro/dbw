# dbw's CI, as four stages.
#
#   docker build --target test .                     the gate: types, tests, bundle, from a clean tree
#   docker build --target dist --output out .        out/dbw-<version>.vsix, only if the gate passed
#
# Everything is pinned: the base image by digest, dependencies by the lock
# file, and dbw itself by DBW_VERSION, which the build checks against the
# manifest rather than trusting.  An image or a .vsix that exists is one
# whose suites passed, however it was built.

# --- the toolchain -----------------------------------------------------------
# node:24-bookworm-slim, 2026-09-21.  The tag moves; the digest does not.
FROM node@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS toolchain
WORKDIR /src
ENV CI=true

# --- the build ---------------------------------------------------------------
# The lock file decides every version.  Install scripts stay off: the one
# that matters (esbuild's) only fetches a binary the optional dependency
# already carries.
FROM toolchain AS build
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/driver-sqlite/package.json packages/driver-sqlite/
COPY packages/driver-postgres/package.json packages/driver-postgres/
COPY packages/driver-mssql/package.json packages/driver-mssql/
COPY packages/language-prql/package.json packages/language-prql/
COPY packages/extension/package.json packages/extension/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
ARG DBW_VERSION
RUN built=$(node -p "require('./packages/extension/package.json').version") \
 && if [ -n "$DBW_VERSION" ] && [ "$built" != "$DBW_VERSION" ]; then \
      echo "asked to build $DBW_VERSION but the tree is $built" >&2; exit 1; \
    fi \
 && npm run typecheck \
 && npm run build

# --- the gate ----------------------------------------------------------------
FROM build AS test
RUN npm test && echo "${DBW_VERSION:-dev}" > /passed

# --- the package -------------------------------------------------------------
# The first line copied comes from `test`, which puts the suites on the path
# to the .vsix rather than beside it.
FROM build AS package
COPY --from=test /passed /passed
RUN npm run package

# --- the artifact, alone -----------------------------------------------------
FROM scratch AS dist
COPY --from=package /src/packages/extension/*.vsix /
