import { supabase } from './supabaseClient.js';
import { Toast } from './utils.js';

/**
 * Initiates the Google OAuth sign-in flow.
 */
export async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: window.location.href, // Redirect to the current page
        },
    });
    if (error) {
        console.error('Error signing in with Google:', error);
        Toast.fire({
            icon: 'error',
            title: 'Sign-in failed',
            text: error.message
        });
    }
}

/**
 * Signs the current user out.
 */
export async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
        console.error('Error signing out:', error);
        Toast.fire({
            icon: 'error',
            title: 'Sign-out failed',
            text: error.message
        });
    }
}

/**
 * Sets up a listener that fires when the user's authentication state changes.
 * @param {function(object|null): void} callback The function to call with the user object or null.
 */
export function onAuthStateChange(callback) {
    supabase.auth.onAuthStateChange((event, session) => {
        const user = session?.user ?? null;
        callback(user);
    });
}

/**
 * Gets the current authenticated user.
 * @returns {Promise<object|null>} The user object or null.
 */
export async function getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

/**
 * Handles the account deletion process.
 * NOTE: This requires a backend Supabase Edge Function to securely delete user data.
 * This client-side function provides the UI and final sign-out.
 */
export async function deleteAccount() {
    const { isConfirmed } = await Swal.fire({
        title: 'Are you absolutely sure?',
        html: `This action cannot be undone. This will permanently delete your account and all of your quiz progress.<br><br><strong>This is an irreversible action.</strong>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Yes, delete it!',
        cancelButtonText: 'Cancel'
    });

    if (isConfirmed) {
        // --- IMPORTANT ---
        // In a real application, you would now call a Supabase Edge Function
        // to securely delete the user's data from all tables (e.g., profiles, attempts)
        // and then finally delete the user from the `auth.users` table using a service_role key.
        // Example: await supabase.functions.invoke('delete-user-account');

        console.log("Simulating account deletion. In a real app, a secure backend function would be called here.");
        Toast.fire({
            icon: 'success',
            title: 'Account deleted successfully.',
            text: 'You have been signed out.'
        });

        // Sign out the user from the client after the backend process
        await signOut();
    }
}
