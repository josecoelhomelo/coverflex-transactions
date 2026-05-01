import fs from 'fs';
import readline from 'readline';
import axios from 'axios';
const endpoint = 'https://menhir-api.coverflex.com/api/employee';
const TOKEN_FILE = 'tokens.json';
let token = null;
const loadTokens = () => {
    try {
        return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
    } catch {
        return {};
    }
};
const saveTokens = (tokens) => {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf-8');
};

/**
 * Prompts the user to enter the one-time code sent to their phone.
 * @returns {Promise<string>} A promise that resolves with the entered code.
 * @throws {Error} If no code is entered.
 */
const requestOTP = () => new Promise((resolve, reject) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question('Enter the code received through SMS: ', (code) => {
        rl.close();
        if (!code) { reject(Error('Code is required')); }
        resolve(code);
    });
});

/**
 * Attempts to get a fresh access token using the stored refresh token.
 * If successful, updates the stored tokens and resolves with the new access token.
 * If the refresh token is missing or the request fails, rejects with an error.
 * @returns {Promise<string>} A promise that resolves to the new access token.
 */
const renewToken = () => new Promise(async (resolve, reject) => {
    const tokens = loadTokens();
    if (!tokens.refresh_token) { 
        reject(Error('No refresh token available'));
        return;
    }
    axios.post(`${endpoint}/sessions/renew`, {}, {
        headers: { 'Authorization': `Bearer ${tokens.refresh_token}` }
    })
        .then((res) => {
            saveTokens({
                ...tokens,
                token: res.data.token,
                refresh_token: res.data.refresh_token
            });
            resolve(res.data.token);
        })
        .catch((err) => reject(Error('Token renewal failed', { cause: JSON.stringify(err.response.data) })));
});

/**
 * Calls /trust-user-agent with the given access token, persists the full
 * token set (token, refresh_token, user_agent_token) and returns the access token.
 * @param {string} accessToken - The access token to trust the user agent with.
 * @returns {Promise<string>} A promise that resolves to the access token.
 * @throws {Error} If the request fails or the response is missing tokens.
 */
const trustUserAgent = (accessToken) => new Promise(async (resolve, reject) => {
    axios.post(`${endpoint}/sessions/trust-user-agent`, {}, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    })
        .then((res) => {
            saveTokens({
                token: res.data.token,
                refresh_token: res.data.refresh_token,
                user_agent_token: res.data.user_agent_token,
            });
            resolve(res.data.token);
        })
        .catch((err) => reject(Error('Trust user agent failed', { cause: JSON.stringify(err.response.data) })));
});

/**
 * Logs in the user with the provided credentials.
 *
 * Priority:
 *   1. Renew via refresh_token (avoids full login entirely)
 *   2. Full login with user_agent_token (skips OTP if device is trusted)
 *   3. Full login with OTP (fallback when both tokens are missing or expired)
 *
 * @param {Object} params - The login parameters.
 * @param {string} params.email - The user's email.
 * @param {string} params.password - The user's password.
 * @param {string} [params.otp] - OTP, only used when falling back to full OTP login.
 * @returns {Promise<string>} A promise that resolves to the access token.
 * @throws {Error} If credentials are missing or all login strategies fail.
 */
const login = async (params) => {
    if (!params.email || !params.password) { throw Error('Login failed', { cause: 'Credentials are required' }); }

    token = await renewToken().catch(() => null);
    if (token) { return token; }

    const tokens = loadTokens();
    const userAgentToken = tokens.user_agent_token;
    try {
        const payload = {
            email: params.email,
            password: params.password,
        };
        if (params.otp) { payload.otp = params.otp; }
        if (userAgentToken) { payload.user_agent_token = userAgentToken; }

        const res = await axios.post(`${endpoint}/sessions`, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        if (!params.otp && !res.data.token) {
            params.otp = await requestOTP();
            return login(params);
        }
        if (!res.data.token) { throw Error('Login failed', { cause: 'Token not found' }); }

        token = await trustUserAgent(res.data.token);
        return token;
    } catch (err) {
        throw Error('Login failed', { cause: err });
    }
};

/**
 * Retrieves transactions from the user's Coverflex account.
 * @param {Object} params - Optional parameters for filtering transactions.
 * @returns {Promise<Array>} A promise that resolves to an array of transactions.
 * @throws {Error} If the token is missing or the request fails.
 */
const getTransactions = (params = {}) => {
    if (!token) { throw Error('Failed to retrieve transactions', { cause: 'Token missing' }); }
    params = { pagination: 'no', ...params };
    return axios.get(`${endpoint}/movements`, {
        params,
        headers: { 'Authorization': `Bearer ${token}` }
    })
        .then((res) => res.data.movements.list)
        .catch((err) => { throw Error('Failed to retrieve transactions', { cause: JSON.stringify(err.response.data) }); });
};

/**
 * Transforms an array of transactions into a CSV string.
 * @param {Array<Object>} transactions - The array of transactions to transform.
 * @returns {string} The CSV string representation of the transactions.
 * @throws {Error} If the transactions array is empty or not provided.
 */
const transformTransactions = (transactions) => {
    if (!transactions || !transactions.length) { throw Error('Transactions not found'); }
    const relevantHeaders = ['executed_at', 'amount', 'description', 'type'];
    const headers = Object.keys(transactions[0]).filter((header) => relevantHeaders.includes(header));
    const body = transactions.reduce((acc, transaction) => {
        const values = headers.map((header) => {
            let value = transaction[header];
            if (value === undefined || value === null) { return ''; }
            if (header === 'amount') {       
                const normalized = Number(value.amount);
                if (!Number.isFinite(normalized)) { return value.amount; }
                return (normalized / 100).toFixed(2); 
            }
            return value;
        });
        return `${acc}${values.join(',')}\n`;
    }, `${headers.join(',')}\n`);
    return body;
};

/**
 * Saves the transactions to a file.
 * @param {Array} transactions - The transactions to be saved.
 * @param {boolean} csv - Indicates whether to save the transactions as CSV or JSON. Default is 'true'.
 * @param {string} folder - The folder where the file will be saved. Default is 'transactions'.
 * @returns {string} - The path of the saved file.
 * @throws {Error} - If transactions is not found.
 */
const saveTransactions = (transactions, csv = true, folder = 'transactions') => {
    if (!transactions) { throw Error('Transactions not found'); }
    if (!fs.existsSync(folder)) { fs.mkdirSync(folder); }
    const date = new Date();
    const timestamp = `${date.getFullYear()}-${(`0` + parseInt(date.getMonth()+1)).slice(-2)}-${(`0` + date.getDate()).slice(-2)}T${(`0` + date.getHours()).slice(-2)}-${(`0` + date.getMinutes()).slice(-2)}`;
    const extension = csv ? 'csv' : 'json';
    const path = `${folder}/${timestamp}.${extension}`;
    const body = csv ? transformTransactions(transactions) : JSON.stringify(transactions);      
    fs.writeFileSync(path, body); 
    return path;
}

export default { login, getTransactions, saveTransactions };
