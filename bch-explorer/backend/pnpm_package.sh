#/bin/sh
set -e

# Remove previous dist folder (if present)
rm -rf dist
# Build new dist folder
pnpm build
# Remove previous package folder (if present)
rm -rf package
# Move JS and deps
mv dist package
cp -R node_modules package
# Copy healthcheck.js
cp healthcheck.js package
# Remove symlink for rust-gbt and insert real folder
rm package/node_modules/rust-gbt
cp -R rust-gbt package/node_modules
# Clean up deps
pnpm package-rm-build-deps
