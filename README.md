Node.js module to retrieve transactions from a Coverflex account.

## Installation

Install the package using npm:

```shell
npm install coverflex-transactions
```

After installing, import it into your project:

```js
import coverflex from 'coverflex-transactions';
```

## Example

Saving transactions to a CSV file:

```js
import coverflex from 'coverflex-transactions';
try {
    await coverflex.login({
        email: 'your-email@provider.com',
        password: 'YourPassword123456'
    });
    const transactions = await coverflex.getTransactions();
    coverflex.saveTransactions(transactions);
} catch (err) {
    console.error(err);
}
```

## Methods

### `login`

Logs in with the provided Coverflex credentials.

```js
coverflex.login({
    email: 'your-email@provider.com',
    password: 'YourPassword123456'
});
```

| Property | Definition |
| -------- | ---------- |
| `email` | The user e-mail address |
| `password` | The user password |
| `otp` | Optional; SMS one-time code, only needed when bypassing the interactive prompt |

On first login, or whenever the trusted session expires, the module will prompt you to enter the SMS code sent by Coverflex. Tokens are stored locally in `tokens.json` so future runs can renew the session or use the trusted user-agent token without asking for a new code.

The login process attempts authentication in this order:

1. Renew the access token using the stored refresh token.
2. Log in with the stored trusted user-agent token.
3. Fall back to a full login and prompt for the SMS OTP code.

This function returns the access token for later use, if needed.

### `getTransactions`

Retrieves transactions from the user's Coverflex account.

```js
coverflex.getTransactions();
```

Optional query parameters can be passed to the Coverflex movements endpoint. By default, the module adds `pagination: 'no'`.

### `saveTransactions`

Saves the transactions to a file, either in CSV or JSON format. Use the second parameter as a boolean to indicate whether to save in CSV format, which defaults to `true`. The third parameter indicates the folder where the file will be saved. Default is `transactions`.

```js
coverflex.saveTransactions(transactionsArray, false, 'some-folder');
```
