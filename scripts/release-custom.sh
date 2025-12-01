#!/bin/bash

# Release script for Cogworks Bot (Custom Version)
# Usage: ./scripts/release-custom.sh <version|version-type> <commit-message>
# Example: ./scripts/release-custom.sh 2.3.1 "Fix baitChannel detection"
# Example: ./scripts/release-custom.sh patch "Fix botSetup lang system integration"
# Version types: major, minor, patch, premajor, preminor, prepatch, prerelease

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if arguments are provided
if [ $# -lt 2 ]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 <version|version-type> <commit-message>"
    echo "Version types: major, minor, patch, premajor, preminor, prepatch, prerelease"
    echo "Or specify exact version: 2.3.1, 3.0.0, etc."
    echo ""
    echo "Examples:"
    echo "  $0 patch \"Fix botSetup lang system integration\""
    echo "  $0 2.3.1 \"Fix baitChannel detection\""
    exit 1
fi

VERSION_ARG=$1
COMMIT_MESSAGE=$2

# Check if we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo -e "${YELLOW}Warning: You are on branch '$CURRENT_BRANCH', not 'main'${NC}"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}Aborted${NC}"
        exit 1
    fi
fi

# Check for uncommitted changes (excluding the files we'll modify)
if [[ -n $(git status --porcelain | grep -v "package.json\|package-lock.json") ]]; then
    echo -e "${YELLOW}Warning: You have uncommitted changes${NC}"
    git status --short
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}Aborted${NC}"
        exit 1
    fi
fi

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}        Cogworks Bot Release Script${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Determine if VERSION_ARG is a version type or specific version
if [[ "$VERSION_ARG" =~ ^(major|minor|patch|premajor|preminor|prepatch|prerelease)$ ]]; then
    # It's a version type - use npm version
    echo -e "${YELLOW}[1/6]${NC} Bumping version (${VERSION_ARG})..."
    NEW_VERSION=$(npm version $VERSION_ARG --no-git-tag-version)
    echo -e "${GREEN}✓${NC} Version bumped to ${GREEN}${NEW_VERSION}${NC}"
elif [[ "$VERSION_ARG" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+(-.*)?$ ]]; then
    # It's a specific version number
    # Remove 'v' prefix if present
    CLEAN_VERSION=${VERSION_ARG#v}
    echo -e "${YELLOW}[1/6]${NC} Setting version to ${CLEAN_VERSION}..."
    npm version $CLEAN_VERSION --no-git-tag-version --allow-same-version
    NEW_VERSION="v${CLEAN_VERSION}"
    echo -e "${GREEN}✓${NC} Version set to ${GREEN}${NEW_VERSION}${NC}"
else
    echo -e "${RED}Error: Invalid version argument '$VERSION_ARG'${NC}"
    echo "Must be either:"
    echo "  - Version type: major, minor, patch, premajor, preminor, prepatch, prerelease"
    echo "  - Specific version: 2.3.1, v3.0.0, 1.2.3-beta.1, etc."
    exit 1
fi
echo

# Step 2: Update package-lock.json
echo -e "${YELLOW}[2/6]${NC} Updating package-lock.json..."
npm install --package-lock-only
echo -e "${GREEN}✓${NC} package-lock.json updated"
echo

# Step 3: Stage changes
echo -e "${YELLOW}[3/6]${NC} Staging all changes..."
git add .
echo -e "${GREEN}✓${NC} Changes staged"
echo

# Step 4: Commit
echo -e "${YELLOW}[4/6]${NC} Creating commit..."
git commit -m "$COMMIT_MESSAGE"
echo -e "${GREEN}✓${NC} Commit created: ${COMMIT_MESSAGE}"
echo

# Step 5: Create tag
echo -e "${YELLOW}[5/6]${NC} Creating git tag ${NEW_VERSION}..."
git tag $NEW_VERSION
echo -e "${GREEN}✓${NC} Tag created: ${NEW_VERSION}"
echo

# Step 6: Push to remote
echo -e "${YELLOW}[6/6]${NC} Pushing to remote..."
echo "  - Pushing branch: $CURRENT_BRANCH"
git push origin $CURRENT_BRANCH
echo "  - Pushing tag: $NEW_VERSION"
git push origin $NEW_VERSION
echo -e "${GREEN}✓${NC} Pushed to remote"
echo

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}        ✓ Release Complete!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo "Version: ${GREEN}${NEW_VERSION}${NC}"
echo "Commit:  ${COMMIT_MESSAGE}"
echo "Branch:  ${CURRENT_BRANCH}"
echo "Tag:     ${NEW_VERSION}"
echo
