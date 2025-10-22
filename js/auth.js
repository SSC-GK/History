import { supabase } from './supabaseClient.js';
import { Toast } from './utils.js';

/**
 * Initiates the Google OAuth sign-in flow.
 */
export async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
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