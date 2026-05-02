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
 * Converts transactions into a CSV string.
 *
 * By default, the CSV includes every top-level key from the first transaction.
 * Pass `headers` to export only selected keys. Object values are JSON-stringified.
 *
 * @param {Array<Object>} transactions - Transactions to export.
 * @param {Array<string>} [headers] - Optional transaction keys to include in the CSV.
 * @returns {string} CSV content, including the header row.
 * @throws {Error} If the transactions array is empty or not provided.
 */
const toCSV = (transactions, headers) => {
    if (!transactions?.length) { throw Error('Transactions not found'); }
    const useHeaders = Object.keys(transactions[0]).filter((header) => headers?.length ? headers.includes(header) : true);
    const escapeCSV = (value) => {
        const stringValue = String(value);
        return /[",\n\r]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
    };
    const body = transactions.reduce((acc, transaction) => {
        const values = useHeaders.map((header) => {
            let value = transaction[header];
            if (value === undefined || value === null) { return ''; }
            return typeof value === 'object' ? JSON.stringify(value) : escapeCSV(value);
        });
        return `${acc}${values.join(',')}\n`;
    }, `${useHeaders.join(',')}\n`);
    return body;
};

/**
 * Saves transactions to a timestamped CSV or JSON file.
 *
 * CSV files are written by default. Pass `{ toCSV: false }` to write the raw
 * transaction array as JSON instead. When writing CSV, `headers` limits the
 * exported fields.
 *
 * @param {Array<Object>} transactions - Transactions to save.
 * @param {Object} [csv] - Export options.
 * @param {boolean} [csv.toCSV=true] - Whether to save as CSV. When false, saves JSON.
 * @param {Array<string>} [csv.headers=[]] - Transaction keys to include in CSV output.
 * @param {string} [folder='transactions'] - Folder where the file will be created.
 * @returns {string} Path of the created file.
 * @throws {Error} If transactions are not provided.
 */
const saveTransactions = (transactions, csv = {}, folder = 'transactions') => {
    if (!transactions) { throw Error('Transactions not found'); }   
    csv = {
        toCSV: true,
        headers: [],
        ...csv
    };
    if (!fs.existsSync(folder)) { fs.mkdirSync(folder); }
    const date = new Date();
    const timestamp = `${date.getFullYear()}-${(`0` + parseInt(date.getMonth()+1)).slice(-2)}-${(`0` + date.getDate()).slice(-2)}T${(`0` + date.getHours()).slice(-2)}-${(`0` + date.getMinutes()).slice(-2)}`;
    const extension = csv.toCSV ? 'csv' : 'json';
    const path = `${folder}/${timestamp}.${extension}`;
    const body = csv.toCSV ? toCSV(transactions, csv.headers) : JSON.stringify(transactions);      
    fs.writeFileSync(path, body); 
    return path;
}

export default { login, getTransactions, saveTransactions };
