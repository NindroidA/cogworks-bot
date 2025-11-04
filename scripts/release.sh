#!/bin/bash

# Release script for Cogworks Bot
# Usage: ./scripts/release.sh <version-type> <commit-message>
# Example: ./scripts/release.sh patch "Fix botSetup lang system integration"
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
    echo "Usage: $0 <version-type> <commit-message>"
    echo "Version types: major, minor, patch, premajor, preminor, prepatch, prerelease"
    echo "Example: $0 patch \"Fix botSetup lang system integration\""
    exit 1
fi

VERSION_TYPE=$1
COMMIT_MESSAGE=$2

# Validate version type
if [[ ! "$VERSION_TYPE" =~ ^(major|minor|patch|premajor|preminor|prepatch|prerelease)$ ]]; then
    echo -e "${RED}Error: Invalid version type '$VERSION_TYPE'${NC}"
    echo "Valid types: major, minor, patch, premajor, preminor, prepatch, prerelease"
    exit 1
fi

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

# Step 1: Bump version
echo -e "${YELLOW}[1/6]${NC} Bumping version (${VERSION_TYPE})..."
NEW_VERSION=$(npm version $VERSION_TYPE --no-git-tag-version)
echo -e "${GREEN}✓${NC} Version bumped to ${GREEN}${NEW_VERSION}${NC}"
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
