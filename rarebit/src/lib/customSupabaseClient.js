import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://girohykpugyiqzssmiio.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdpcm9oeWtwdWd5aXF6c3NtaWlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEwMTE1NDIsImV4cCI6MjA2NjU4NzU0Mn0.sbg4I2hX8vd8FCbxom7qhwI2GQYZ8Xo1vJYw6ktRu5w';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);