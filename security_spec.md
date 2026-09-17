# Firestore Security Specification

This specification defines the security invariants and threat vectors for the Remix: AI Talk Radio application.

## 1. Data Invariants

1. **User Profiles (`/users/{userId}`)**:
   - A user profile can only be created or written by the authenticated user matching `userId`.
   - A user profile can only be read by the authenticated user matching `userId`.
   - Users cannot edit system fields after creation or elevate permissions.

2. **Radio Shows (`/shows/{showId}`)**:
   - A radio show document can only be created or modified if the user is authenticated and the show's `userId` matches the user's `uid`.
   - Only the owning user can list or read their own shows.
   - Shows have strict schemas: all required fields (duration, transcript, host, title, audioUrl) must be validated.
   - Immutability of identity fields: once a show is created, the `userId` field cannot be modified.
   - Timestamp integrity: `createdAt` must match the server timestamp on creation, and `updatedAt` must match the server timestamp on update.

---

## 2. The "Dirty Dozen" Payloads

Here are 12 specific payloads designed to challenge the security boundaries of our Firestore rules.

### Test 1: Identity Spoofing (Create Show with fake `userId`)
```json
// Path: /shows/malicious_show_1
// Actor: authenticated_user_abc
// Expectation: PERMISSION_DENIED
{
  "userId": "other_victim_user_xyz",
  "title": "Spoofed Owner Show",
  "duration": 180,
  "summary": "This show claims to belong to a victim.",
  "date": "2026-06-27",
  "host": "Jordan",
  "coverImage": "https://example.com/cover.jpg",
  "audioUrl": "https://example.com/audio.mp3",
  "transcript": [],
  "createdAt": "request.time",
  "updatedAt": "request.time"
}
```

### Test 2: Unauthenticated Write (Create Show without logging in)
```json
// Path: /shows/anonymous_show_1
// Actor: unauthenticated_guest
// Expectation: PERMISSION_DENIED
{
  "userId": "guest_uid",
  "title": "Anonymous Show",
  "duration": 120,
  "summary": "This shouldn't be allowed.",
  "date": "2026-06-27",
  "host": "Jordan",
  "coverImage": "https://example.com/cover.jpg",
  "audioUrl": "https://example.com/audio.mp3",
  "transcript": [],
  "createdAt": "request.time",
  "updatedAt": "request.time"
}
```

### Test 3: ID Poisoning (Extremely long document ID)
```json
// Path: /shows/a_very_long_id_exceeding_128_chars_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
// Actor: authenticated_user_abc
// Expectation: PERMISSION_DENIED
{
  "userId": "authenticated_user_abc",
  "title": "ID Poisoning",
  "duration": 180,
  "summary": "Show with oversized document ID.",
  "date": "2026-06-27",
  "host": "Jordan",
  "coverImage": "https://example.com/cover.jpg",
  "audioUrl": "https://example.com/audio.mp3",
  "transcript": [],
  "createdAt": "request.time",
  "updatedAt": "request.time"
}
```

### Test 4: Resource Exhaustion (Extremely large text fields)
```json
// Path: /shows/oversized_fields_1
// Actor: authenticated_user_abc
// Expectation: PERMISSION_DENIED (summary length exceeds limits)
{
  "userId": "authenticated_user_abc",
  "title": "Oversized",
  "duration": 180,
  "summary": "A".repeat(50000), // 50KB string
  "date": "2026-06-27",
  "host": "Jordan",
  "coverImage": "https://example.com/cover.jpg",
  "audioUrl": "https://example.com/audio.mp3",
  "transcript": [],
  "createdAt": "request.time",
  "updatedAt": "request.time"
}
```

### Test 5: Missing Required Fields
```json
// Path: /shows/missing_fields_1
// Actor: authenticated_user_abc
// Expectation: PERMISSION_DENIED (no transcript, no host)
{
  "userId": "authenticated_user_abc",
  "title": "Incomplete Show",
  "duration": 180,
  "summary": "A show without host and transcript.",
  "date": "2026-06-27",
  "coverImage": "https://example.com/cover.jpg",
  "audioUrl": "https://example.com/audio.mp3",
  "createdAt": "request.time",
  "updatedAt": "request.time"
}
```

### Test 6: Timestamp Manipulation (Malicious client timestamp)
```json
// Path: /shows/fake_timestamp_1
// Actor: authenticated_user_abc
// Expectation: PERMISSION_DENIED (createdAt must be request.time)
{
  "userId": "authenticated_user_abc",
  "title": "Fake Timestamp Show",
  "duration": 180,
  "summary": "Backdated creation time.",
  "date": "2026-06-27",
  "host": "Jordan",
  "coverImage": "https://example.com/cover.jpg",
  "audioUrl": "https://example.com/audio.mp3",
  "transcript": [],
  "createdAt": "2020-01-01T00:00:00Z",
  "updatedAt": "request.time"
}
```

### Test 7: Shadow Update (Injecting un-whitelisted fields during update)
```json
// Path: /shows/existing_show_abc
// Actor: authenticated_user_abc
// Expectation: PERMISSION_DENIED (injecting ghost_field)
{
  "userId": "authenticated_user_abc",
  "title": "Updated Show",
  "duration": 180,
  "summary": "Updating summary.",
  "date": "2026-06-27",
  "host": "Jordan",
  "coverImage": "https://example.com/cover.jpg",
  "audioUrl": "https://example.com/audio.mp3",
  "transcript": [],
  "createdAt": "existing().createdAt",
  "updatedAt": "request.time",
  "ghost_field": "hacker_was_here"
}
```

### Test 8: State Hijacking (Modifying immutable userId on update)
```json
// Path: /shows/existing_show_abc
// Actor: authenticated_user_abc
// Expectation: PERMISSION_DENIED
{
  "userId": "compromised_victim_user",
  "title": "Hijacked Show",
  "duration": 180,
  "summary": "Updating owner ID.",
  "date": "2026-06-27",
  "host": "Jordan",
  "coverImage": "https://example.com/cover.jpg",
  "audioUrl": "https://example.com/audio.mp3",
  "transcript": [],
  "createdAt": "existing().createdAt",
  "updatedAt": "request.time"
}
```

### Test 9: Type Poisoning (String instead of integer duration)
```json
// Path: /shows/type_poison_1
// Actor: authenticated_user_abc
// Expectation: PERMISSION_DENIED (duration must be number)
{
  "userId": "authenticated_user_abc",
  "title": "Type Poisoning",
  "duration": "one hundred seconds",
  "summary": "Duration is a string.",
  "date": "2026-06-27",
  "host": "Jordan",
  "coverImage": "https://example.com/cover.jpg",
  "audioUrl": "https://example.com/audio.mp3",
  "transcript": [],
  "createdAt": "request.time",
  "updatedAt": "request.time"
}
```

### Test 10: Array Guarding (Massive transcript array size)
```json
// Path: /shows/massive_array_1
// Actor: authenticated_user_abc
// Expectation: PERMISSION_DENIED (transcript size exceeds limit)
{
  "userId": "authenticated_user_abc",
  "title": "Oversized Transcript",
  "duration": 180,
  "summary": "Show with too many transcript lines.",
  "date": "2026-06-27",
  "host": "Jordan",
  "coverImage": "https://example.com/cover.jpg",
  "audioUrl": "https://example.com/audio.mp3",
  "transcript": "A".repeat(5000).split(""), // 5000 items
  "createdAt": "request.time",
  "updatedAt": "request.time"
}
```

### Test 11: PII Leak Attempt (Blanket read of all user profiles)
```json
// Path: /users
// Actor: authenticated_user_abc (trying to list /users)
// Expectation: PERMISSION_DENIED
```

### Test 12: Orphaned Write (Write Show for non-existent user)
```json
// Path: /shows/orphan_show_1
// Actor: authenticated_user_abc
// Expectation: PERMISSION_DENIED (if checking parent user profile existence)
```

---

## 3. Test Runner Mock Definition

The security tests will be validated against the Firestore security rules.
An automated test runner is stubbed out below to illustrate testing execution:

```typescript
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";

describe("Remix AI Radio Security Rules", () => {
  // Test suite structure validating each of the Dirty Dozen above.
});
```
