# Database Schema Documentation

## Overview

This directory contains the database schema and migrations for the DigitalTwin SaaS application.

## Phase 1 Schema

### Tables

#### `profiles`

Extended user profiles that link to Supabase Auth users.

**Columns:**
- `id` (UUID, PRIMARY KEY) - References `auth.users(id)`
- `email` (TEXT, NOT NULL) - User email address
- `role` (TEXT, NOT NULL) - User role: 'admin' or 'customer' (default: 'customer')
- `created_at` (TIMESTAMP) - Account creation timestamp
- `updated_at` (TIMESTAMP) - Last update timestamp

**Indexes:**
- `profiles_email_idx` - Index on email for faster lookups
- `profiles_role_idx` - Index on role for admin queries

**Row Level Security (RLS):**
- ✅ Enabled on all operations
- Users can view/update their own profile
- Admins can view all profiles
- Users can insert their own profile on signup

## Setup Instructions

1. **Run the schema migration:**
   - Go to your Supabase project dashboard
   - Navigate to SQL Editor
   - Copy and paste the contents of `schema.sql`
   - Execute the script

2. **Verify RLS is enabled:**
   - Go to Table Editor in Supabase
   - Select the `profiles` table
   - Verify "Enable Row Level Security" is checked

3. **Test the policies:**
   - Create a test user via signup
   - Verify profile is created automatically
   - Test that users can only see their own profile

## Security Notes

- All tables have RLS enabled by default
- Policies follow the principle of least privilege
- Admin access is explicitly checked via role
- Profile creation is automated via trigger

## Future Schema Additions (Phase 2+)

- `chat_messages` - Chat conversation history
- `chat_sessions` - Chat session tracking
- `admin_settings` - Admin configuration

These will be added in later phases as needed.
