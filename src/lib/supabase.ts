import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ruuiqycgrvjhrqwiafam.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1dWlxeWNncnZqaHJxd2lhZmFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNTUwNjgsImV4cCI6MjEwMDgzMTA2OH0.dSIZBcouRjDvnsdSN84HQBioIGM50E5O1cd4xg1FO0s'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
