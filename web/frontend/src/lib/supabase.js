import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL  = 'https://qhfzxncdrkaawowqjqnt.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoZnp4bmNkcmthYXdvd3FqcW50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODIzMDksImV4cCI6MjA5MTY1ODMwOX0.LNMDRxXVbwUdMlP-ubv9H6fnJQWLUpYV2dmMqd5KSMA'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)
