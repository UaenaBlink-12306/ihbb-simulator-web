// config.js
// Initialize Supabase Client
// Please replace these placeholders with your actual Supabase URL and Anon Key
const SUPABASE_URL = 'https://laexxsgzldivvizwfjcn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZXh4c2d6bGRpdnZpendmamNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0OTg0ODQsImV4cCI6MjA4ODA3NDQ4NH0.t5pMj7nrwqmIyhklkPQb8gyxdNl29LaEoBOdNJNaKZ4';

// Ensure this script runs after the Supabase CDN script is loaded
if (window.supabase) {
    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
    console.warn("Supabase SDK not loaded. Ensure the CDN script is included.");
}
