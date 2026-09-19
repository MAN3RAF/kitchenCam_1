# KitchenCam Codex Instructions

## Project Scope

KitchenCam is a planned React Native / Expo mobile application that identifies ingredients from photos and recommends recipes with nutrition information.

Do not implement app features unless the user explicitly asks for implementation. When the user asks to prepare, plan, audit, or document the repository, keep changes limited to that request.

## Target Stack

- React Native with Expo
- TypeScript in strict mode
- Expo Router
- Supabase for backend data and auth
- OpenAI API for ingredient and recipe intelligence
- RevenueCat for subscriptions
- Google AdMob for advertising

## Architecture

Use a feature-oriented architecture. Keep separate:

- UI components
- business logic
- API and service clients
- database access
- state management
- types and schemas

Keep business logic out of React components. Prefer small, testable modules and explicit interfaces between app features and external services.

## Mobile App Requirements

Every asynchronous screen or flow must account for:

- loading
- error
- empty
- success

Design for different phone sizes from the start. Respect safe areas, keyboard behavior, touch target sizing, accessibility labels, reduced motion, and platform navigation expectations.

## Security

Never hardcode API keys, service credentials, tokens, or secrets. Use environment variables and Expo-safe configuration patterns.

Never expose server-only credentials to the mobile client. Treat Supabase service-role keys, OpenAI API keys, RevenueCat secrets, and AdMob administrative credentials as server-side only.

## Code Quality

- Avoid `any`; prefer precise TypeScript types.
- Prefer reusable components and hooks when they reduce duplication.
- Keep files reasonably small and cohesive.
- Use descriptive names.
- Remove dead code.
- Do not duplicate logic.
- Follow existing project conventions once the app is scaffolded.

## Development Workflow

Before implementing a major feature:

1. Inspect the existing code.
2. Understand the current architecture.
3. Make a short implementation plan.
4. Implement the smallest complete version.
5. Run TypeScript checks.
6. Run linting.
7. Run relevant tests.
8. Fix errors before declaring the task complete.

Do not claim something works unless it has been verified.

## Project Skills

Project-local Codex skills live in `.agents/skills`. Use only skills that are relevant to building or reviewing this production React Native / Expo app. Do not add broad, unrelated skill packs.
