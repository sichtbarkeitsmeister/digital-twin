# Security Guidelines and Rules

**This document contains MANDATORY security rules that MUST be followed in all code development.**

## Table of Contents

1. [MANDATORY Security Rules](#mandatory-security-rules)
2. [Supabase API Key Management](#supabase-api-key-management)
3. [Row Level Security (RLS) Policies](#row-level-security-rls-policies)
4. [Authentication Security](#authentication-security)
5. [Input Validation & Sanitization](#input-validation--sanitization)
6. [API Route Security](#api-route-security)
7. [Environment Variables](#environment-variables)
8. [Next.js-Specific Security](#nextjs-specific-security)
9. [Code Examples](#code-examples)
10. [Pre-Commit Checklist](#pre-commit-checklist)

---

## MANDATORY Security Rules

### Zero-Tolerance Violations

The following violations are **NEVER** acceptable and will result in immediate code rejection:

1. **NEVER expose `service_role` key on the frontend** - This key bypasses all RLS policies
2. **NEVER disable RLS on any table** - All tables MUST have RLS enabled
3. **NEVER commit secrets to git** - All secrets must be in environment variables
4. **NEVER trust client-side data** - Always validate on the server
5. **NEVER expose sensitive data in error messages** - Sanitize all error responses

### Code Review Checklist

Before any code is merged, verify:

- [ ] No `service_role` key in client-side code
- [ ] All database tables have RLS enabled
- [ ] All user inputs are validated and sanitized
- [ ] All API routes have authentication checks
- [ ] All environment variables are properly configured
- [ ] No secrets are hardcoded in the codebase
- [ ] Error messages don't expose sensitive information
- [ ] Rate limiting is implemented on API routes

---

## Supabase API Key Management

### Rules

1. **Use `anon` key for client-side operations ONLY**

   - The `anon` key respects RLS policies
   - Safe to expose in browser/client-side code
   - Must be prefixed with `NEXT_PUBLIC_` in environment variables

2. **NEVER expose `service_role` key on frontend**

   - This key bypasses ALL RLS policies
   - Grants full database access
   - MUST only be used in server-side code (API routes, Server Components, Server Actions)

3. **Store keys in environment variables ONLY**

   - Never hardcode keys in source code
   - Use `.env.local` for local development
   - Add `.env.local` to `.gitignore`

4. **Key Rotation Procedures**
   - Rotate keys quarterly or after any security incident
   - Update environment variables in all environments
   - Test thoroughly after rotation

### Secure Code Pattern

```typescript
// ✅ CORRECT: Client-side (Browser)
// src/lib/supabase/client.ts
import { createClient } from "@supabase/supabase-js";
import { Database } from "@/types/supabase";

export const createBrowserClient = () => {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! // ✅ anon key only
  );
};

// ✅ CORRECT: Server-side (API Routes, Server Components)
// src/lib/supabase/server.ts
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { Database } from "@/types/supabase";

export const createServerSupabaseClient = () => {
  const cookieStore = cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, // ✅ Use anon key with RLS
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
};

// ✅ CORRECT: Service role key ONLY in server-side admin operations
// src/lib/supabase/admin.ts (if needed for admin operations)
import { createClient } from "@supabase/supabase-js";
import { Database } from "@/types/supabase";

export const createAdminClient = () => {
  // ⚠️ WARNING: Only use in server-side API routes with proper admin verification
  if (typeof window !== "undefined") {
    throw new Error("Admin client cannot be used in browser");
  }

  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY! // ✅ Only server-side, with admin checks
  );
};
```

### Insecure Code Pattern

```typescript
// ❌ WRONG: Service role key in client-side code
// This is a CRITICAL SECURITY VIOLATION
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // ❌ NEVER DO THIS
);

// ❌ WRONG: Hardcoded keys
const supabase = createClient(
  "https://xxx.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." // ❌ NEVER HARDCODE KEYS
);
```

---

## Row Level Security (RLS) Policies

### Rules

1. **Enable RLS on ALL tables by default**

   - Every table MUST have RLS enabled
   - No exceptions without explicit security review

2. **Principle of Least Privilege**

   - Users should only access data they're authorized to see
   - Policies should be as restrictive as possible
   - Grant minimum permissions necessary

3. **Secure by Default**
   - When in doubt, deny access
   - Explicitly allow access only when needed
   - Test policies thoroughly

### RLS Policy Templates

#### User Can Only Access Their Own Data

```sql
-- ✅ CORRECT: Users can view their own profile
CREATE POLICY "Users can view own profile"
ON profiles
FOR SELECT
USING (auth.uid() = id);

-- ✅ CORRECT: Users can update their own profile
CREATE POLICY "Users can update own profile"
ON profiles
FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);
```

#### Admin-Only Access

```sql
-- ✅ CORRECT: Only admins can access admin settings
CREATE POLICY "Admins can view admin settings"
ON admin_settings
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin'
  )
);
```

#### Public Read, Authenticated Write

```sql
-- ✅ CORRECT: Public can read, authenticated users can write
CREATE POLICY "Public read access"
ON public_content
FOR SELECT
TO public
USING (true);

CREATE POLICY "Authenticated users can insert"
ON public_content
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);
```

### Insecure Patterns

```sql
-- ❌ WRONG: RLS disabled
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY; -- ❌ NEVER DO THIS

-- ❌ WRONG: Overly permissive policy
CREATE POLICY "Anyone can do anything"
ON profiles
FOR ALL
USING (true); -- ❌ TOO PERMISSIVE

-- ❌ WRONG: No policy (default deny, but explicit is better)
-- Missing policies mean no access, but always be explicit
```

---

## Authentication Security

### Rules

1. **Server-Side Session Validation**

   - Always validate sessions on the server
   - Never trust client-side session claims
   - Use middleware for route protection

2. **Role-Based Access Control (RBAC)**

   - Verify user roles on every protected route
   - Store roles in database, not JWT claims alone
   - Check roles server-side

3. **Secure Password Requirements**

   - Minimum 8 characters
   - Require uppercase, lowercase, numbers
   - Consider requiring special characters
   - Use Supabase's built-in password validation

4. **Session Management**
   - Implement session timeout
   - Refresh tokens securely
   - Invalidate sessions on logout
   - Handle token expiration gracefully

### Secure Code Pattern

```typescript
// ✅ CORRECT: Server-side session validation
// src/middleware.ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          response.cookies.set(name, value, options);
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Protect admin routes
  if (request.nextUrl.pathname.startsWith("/admin")) {
    if (!user) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    // ✅ Verify admin role from database
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "admin") {
      return NextResponse.redirect(new URL("/unauthorized", request.url));
    }
  }

  return response;
}

// ✅ CORRECT: API route with authentication
// src/app/api/protected/route.ts
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return Response.json(
      { error: "Unauthorized" }, // ✅ Generic error message
      { status: 401 }
    );
  }

  // ✅ Verify role from database
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    return Response.json(
      { error: "Forbidden" }, // ✅ Generic error message
      { status: 403 }
    );
  }

  // Protected logic here
  return Response.json({ data: "Protected data" });
}
```

### Insecure Patterns

```typescript
// ❌ WRONG: Trusting client-side authentication
// Client Component
"use client";
export function ProtectedComponent() {
  const { user } = useAuth(); // ❌ Client-side only check

  if (!user) return null; // ❌ Can be bypassed

  return <AdminPanel />;
}

// ❌ WRONG: Exposing sensitive error details
if (!user) {
  return Response.json(
    {
      error: `User ${userId} not found in database ${dbName}`, // ❌ Too much info
    },
    { status: 404 }
  );
}
```

---

## Input Validation & Sanitization

### Rules

1. **Validate ALL user inputs**

   - Never trust client-side validation alone
   - Validate on the server for all inputs
   - Use TypeScript types and runtime validation

2. **Sanitize data before database operations**

   - Use parameterized queries (Supabase handles this)
   - Escape special characters when needed
   - Validate data types and formats

3. **Prevent Common Attacks**
   - SQL Injection (Supabase handles this, but be careful with raw SQL)
   - XSS (Cross-Site Scripting)
   - CSRF (Cross-Site Request Forgery)

### Secure Code Pattern

```typescript
// ✅ CORRECT: Input validation with Zod
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// ✅ CORRECT: Server Action with validation
// src/app/actions/auth.ts
("use server");

import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function loginAction(formData: FormData) {
  // ✅ Validate input
  const result = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    return {
      error: "Invalid input", // ✅ Generic error
      details: result.error.flatten(),
    };
  }

  const { email, password } = result.data;

  // ✅ Sanitized input passed to Supabase
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(), // ✅ Sanitize
    password,
  });

  if (error) {
    return { error: "Invalid credentials" }; // ✅ Generic error
  }

  return { success: true };
}

// ✅ CORRECT: XSS prevention in components
// React automatically escapes content, but be careful with dangerouslySetInnerHTML
export function SafeComponent({ content }: { content: string }) {
  // ✅ Safe: React escapes by default
  return <div>{content}</div>;

  // ⚠️ DANGEROUS: Only use if content is sanitized
  // return <div dangerouslySetInnerHTML={{ __html: sanitize(content) }} />
}
```

### Insecure Patterns

```typescript
// ❌ WRONG: No input validation
export async function loginAction(formData: FormData) {
  const email = formData.get("email"); // ❌ No validation
  const password = formData.get("password"); // ❌ No validation

  // Direct use without sanitization
  await supabase.auth.signInWithPassword({ email, password });
}

// ❌ WRONG: Exposing detailed errors
if (error) {
  return {
    error: `SQL Error: ${error.message}`, // ❌ Exposes internal details
    query: error.query, // ❌ Exposes query structure
  };
}

// ❌ WRONG: Unsanitized HTML rendering
<div dangerouslySetInnerHTML={{ __html: userInput }} />; // ❌ XSS risk
```

---

## API Route Security

### Rules

1. **Rate Limiting**

   - Implement rate limiting on all API routes
   - Prevent brute force attacks
   - Use middleware or external service

2. **Authentication Middleware**

   - Verify authentication on every protected route
   - Check user roles server-side
   - Handle expired sessions gracefully

3. **Request Validation**

   - Validate all request parameters
   - Check request size limits
   - Verify content types

4. **Error Message Sanitization**
   - Never expose internal errors to clients
   - Use generic error messages
   - Log detailed errors server-side only

### Secure Code Pattern

```typescript
// ✅ CORRECT: API route with rate limiting and validation
// src/app/api/auth/login/route.ts
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

// Simple rate limiting (consider using Upstash Redis for production)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const limit = rateLimitMap.get(ip);

  if (!limit || now > limit.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60000 }); // 1 minute window
    return true;
  }

  if (limit.count >= 5) {
    // 5 attempts per minute
    return false;
  }

  limit.count++;
  return true;
}

export async function POST(request: Request) {
  // ✅ Rate limiting
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  if (!checkRateLimit(ip)) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  // ✅ Validate request body
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  // ✅ Validate input schema
  const result = loginSchema.safeParse(body);
  if (!result.success) {
    return Response.json(
      { error: "Invalid input" }, // ✅ Generic error
      { status: 400 }
    );
  }

  const { email, password } = result.data;

  // ✅ Authenticate
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) {
    // ✅ Generic error message (don't reveal if email exists)
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }

  return Response.json({ success: true });
}
```

### Insecure Patterns

```typescript
// ❌ WRONG: No rate limiting
export async function POST(request: Request) {
  // No rate limiting - vulnerable to brute force
  const body = await request.json();
  // ...
}

// ❌ WRONG: Detailed error messages
if (error.code === "invalid_credentials") {
  return Response.json({
    error: `User ${email} not found in database`, // ❌ Reveals user existence
    code: error.code, // ❌ Exposes internal codes
  });
}

// ❌ WRONG: No input validation
export async function POST(request: Request) {
  const body = await request.json();
  // Direct use without validation
  await supabase.from("users").insert(body); // ❌ SQL injection risk
}
```

---

## Environment Variables

### Rules

1. **Never commit secrets to git**

   - All secrets must be in environment variables
   - Use `.env.local` for local development
   - Add `.env.local` to `.gitignore`

2. **Validation at startup**

   - Validate all required environment variables
   - Fail fast if required vars are missing
   - Provide clear error messages

3. **Environment-specific configurations**
   - Use different keys for dev/staging/prod
   - Never use production keys in development
   - Rotate keys regularly

### Secure Code Pattern

```typescript
// ✅ CORRECT: Environment variable validation
// src/lib/env.ts
function getEnvVar(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const env = {
  supabaseUrl: getEnvVar("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: getEnvVar("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY, // Optional, server-only
} as const;

// ✅ CORRECT: Runtime validation
if (typeof window !== "undefined" && env.supabaseServiceRoleKey) {
  throw new Error("Service role key must not be exposed to client");
}
```

### Insecure Patterns

```typescript
// ❌ WRONG: No validation
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL; // ❌ Could be undefined

// ❌ WRONG: Hardcoded values
const supabaseUrl = "https://xxx.supabase.co"; // ❌ Never hardcode

// ❌ WRONG: Exposing service role key
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // ❌ If exposed to client
);
```

---

## Next.js-Specific Security

### Middleware Security

```typescript
// ✅ CORRECT: Secure middleware pattern
// src/middleware.ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // ✅ Add security headers
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // ✅ CSRF protection (Supabase handles this, but good practice)
  if (request.method === "POST") {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (origin && !origin.includes(host!)) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  // Authentication check
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Protect routes
  if (request.nextUrl.pathname.startsWith("/dashboard") && !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

### Server Component Security

```typescript
// ✅ CORRECT: Server component with authentication
// src/app/dashboard/page.tsx
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // ✅ Server-side data fetching with RLS
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return (
    <div>
      <h1>Welcome, {profile?.email}</h1>
      {/* Server component - data never exposed to client */}
    </div>
  );
}
```

### Client Component Security

```typescript
// ✅ CORRECT: Client component with proper data handling
"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export function UserProfile() {
  const [user, setUser] = useState(null);
  const supabase = createBrowserClient();

  useEffect(() => {
    // ✅ Client-side auth check (supplementary to server check)
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });
  }, []);

  // ✅ Never expose sensitive data
  return (
    <div>
      <p>Email: {user?.email}</p>
      {/* ✅ Don't expose: user.id, tokens, etc. */}
    </div>
  );
}
```

---

## Code Examples

### Complete Secure Authentication Flow

```typescript
// ✅ CORRECT: Complete secure login flow

// 1. Client Component (UI only)
// src/components/auth/LoginForm.tsx
"use client";

import { useState } from "react";
import { loginAction } from "@/app/actions/auth";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const result = await loginAction(formData);

    if (result.error) {
      setError(result.error); // ✅ Generic error shown to user
      setLoading(false);
    } else {
      window.location.href = "/dashboard"; // ✅ Server-side redirect
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input name="email" type="email" required />
      <input name="password" type="password" required minLength={8} />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={loading}>
        Login
      </button>
    </form>
  );
}

// 2. Server Action (Validation & Authentication)
// src/app/actions/auth.ts
("use server");

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { z } from "zod";
import { redirect } from "next/navigation";

const loginSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Password too short"),
});

export async function loginAction(formData: FormData) {
  const result = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    return { error: "Invalid input" };
  }

  const { email, password } = result.data;
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) {
    return { error: "Invalid credentials" }; // ✅ Generic error
  }

  redirect("/dashboard");
}
```

---

## Pre-Commit Checklist

Before committing any code, verify:

### Security Checks

- [ ] No `service_role` key in client-side code
- [ ] All database tables have RLS enabled
- [ ] All user inputs are validated server-side
- [ ] All API routes have authentication checks
- [ ] No secrets hardcoded in code
- [ ] Error messages are generic (no sensitive info)
- [ ] Environment variables are properly configured
- [ ] Rate limiting implemented on API routes

### Code Quality Checks

- [ ] TypeScript types are correct
- [ ] No `any` types without justification
- [ ] All async operations have error handling
- [ ] Code follows project conventions
- [ ] No console.log statements in production code
- [ ] All imports are used

### Testing Checks

- [ ] Authentication flows tested
- [ ] Error cases handled
- [ ] Edge cases considered
- [ ] No breaking changes to existing functionality

---

## Additional Resources

- [Supabase Security Best Practices](https://supabase.com/docs/guides/database/secure-data)
- [Next.js Security Headers](https://nextjs.org/docs/app/api-reference/next-config-js/headers)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [TypeScript Security](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)

---

**Remember: Security is not optional. When in doubt, choose the more secure option.**

**Last Updated:** 2024
**Review Frequency:** Quarterly or after any security incident
