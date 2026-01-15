#!/usr/bin/env node
/**
 * Script to generate TypeScript types from Supabase database schema
 *
 * Usage:
 *   npm run types:generate
 *
 * Requires:
 *   - SUPABASE_PROJECT_ID environment variable (in .env.local)
 *   - SUPABASE_ACCESS_TOKEN environment variable (in .env.local) OR be logged in via CLI
 *   - Supabase CLI installed globally or via npx
 */

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

// Load environment variables from .env.local
const envPath = path.join(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, 'utf-8')
  envFile.split('\n').forEach((line) => {
    const trimmedLine = line.trim()
    // Skip comments and empty lines
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const match = trimmedLine.match(/^([^=]+)=(.*)$/)
      if (match) {
        const key = match[1].trim()
        const value = match[2].trim().replace(/^["']|["']$/g, '') // Remove quotes if present
        if (!process.env[key]) {
          process.env[key] = value
        }
      }
    }
  })
}

const SUPABASE_PROJECT_ID = process.env.SUPABASE_PROJECT_ID
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN

if (!SUPABASE_PROJECT_ID) {
  console.error('❌ Error: SUPABASE_PROJECT_ID environment variable is not set')
  console.error('   Please set it in your .env.local file')
  process.exit(1)
}

const TYPES_FILE = path.join(process.cwd(), 'lib/types/supabase.ts')

console.log('🔄 Generating Supabase TypeScript types...')
console.log(`   Project ID: ${SUPABASE_PROJECT_ID}`)

// Authenticate with Supabase if access token is provided
if (SUPABASE_ACCESS_TOKEN) {
  console.log('🔐 Authenticating with Supabase...')
  try {
    execSync(`npx supabase login --token "${SUPABASE_ACCESS_TOKEN}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    })
    console.log('✅ Authenticated successfully')
  } catch {
    console.warn('⚠️  Authentication failed, trying without token...')
    console.warn('   You may need to run: npx supabase login')
  }
}

try {
  // Generate types using Supabase CLI
  const types = execSync(`npx supabase gen types typescript --project-id ${SUPABASE_PROJECT_ID}`, {
    encoding: 'utf-8',
  })

  // Write to file
  fs.writeFileSync(TYPES_FILE, types, 'utf-8')

  console.log('✅ Types generated successfully!')
  console.log(`   Output: ${TYPES_FILE}`)
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error)

  console.error('❌ Error generating types:')
  console.error(message)

  // Provide helpful error message
  if (message.includes('privileges') || message.includes('access')) {
    console.error('\n💡 Tip: You need to authenticate with Supabase CLI.')
    console.error('   Option 1: Add SUPABASE_ACCESS_TOKEN to your .env.local file')
    console.error('   Option 2: Run: npx supabase login')
    console.error('\n   Get your access token from: https://app.supabase.com/account/tokens')
  }

  process.exit(1)
}
