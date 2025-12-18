// auth.js

export function setupAuth(onLogin) {
    const authContainer = document.getElementById('auth-container');
    const appContainer = document.querySelector('.container');

    document.getElementById('login-form').addEventListener('submit', login);
    document.getElementById('signup-form').addEventListener('submit', signup);
    document.getElementById('reset-form').addEventListener('submit', reset);

    supabaseClient.auth.onAuthStateChange((_, session) => {
        if (session?.user) {
            authContainer.style.display = 'none';
            appContainer.style.display = 'block';
            onLogin(session.user);
        } else {
            authContainer.style.display = 'flex';
            appContainer.style.display = 'none';
            window.app = null;
        }
    });
}

async function login(e) {
    e.preventDefault();
    const email = loginEmail.value;
    const password = loginPassword.value;
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
}

async function signup(e) {
    e.preventDefault();
    const email = signupEmail.value;
    const password = signupPassword.value;
    const confirm = signupConfirm.value;

    if (password !== confirm) return alert('Passwords do not match');

    const { error } = await supabaseClient.auth.signUp({ email, password });
    if (!error) {
        alert('Verify your email before logging in');
        document.querySelector('#login-form button').disabled = true;
    }
}

async function reset(e) {
    e.preventDefault();
    await supabaseClient.auth.resetPasswordForEmail(resetEmail.value);
    alert('Reset email sent');
}
