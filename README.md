Node.js module to retrieve transactions from a Coverflex account and save them
as CSV or JSON files.

## Installation

Install the package using npm:

```shell
npm install coverflex-transactions
```

Import it into your project:

```js
import coverflex from 'coverflex-transactions';
```

## Example

Saving all transactions to a CSV file:

```js
import coverflex from 'coverflex-transactions';

try {
    await coverflex.login({
        email: 'your-email@provider.com',
        password: 'YourPassword123456'
    });

    const transactions = await coverflex.getTransactions();
    const path = coverflex.saveTransactions(transactions);

    console.log(`Transactions saved to ${path}`);
} catch (err) {
    console.error(err);
}
```

Saving selected fields:

```js
coverflex.saveTransactions(transactions, {
    headers: ['executed_at', 'description', 'amount', 'is_debit']
});
```

## Methods

### `login`

Logs in with the provided Coverflex credentials and stores session tokens in
`tokens.json` in the current working directory.

```js
coverflex.login({
    email: 'your-email@provider.com',
    password: 'YourPassword123456'
});
```

| Property | Definition |
| -------- | ---------- |
| `email` | The user email address. |
| `password` | The user password. |
| `otp` | Optional SMS one-time code. If omitted and required, the module prompts for it interactively. |

The login flow tries these strategies in order:

1. Renew the access token with the stored refresh token.
2. Log in with the stored trusted user-agent token.
3. Fall back to a full login and request the SMS OTP code.

Returns the access token.

### `getTransactions`

Retrieves transactions from the user's Coverflex account.

```js
coverflex.getTransactions();
```

Optional query parameters are passed to the Coverflex movements endpoint. The
module adds `pagination: 'no'` by default.

### `saveTransactions`

Saves transactions to a timestamped file. CSV output is enabled by default and
files are written to the `transactions` folder unless another folder is passed.

```js
coverflex.saveTransactions(transactions);
```

Write JSON instead:

```js
coverflex.saveTransactions(transactions, { toCSV: false });
```

Write CSV to a custom folder:

```js
coverflex.saveTransactions(transactions, {}, 'exports');
```

CSV options:

| Property | Definition |
| -------- | ---------- |
| `toCSV` | Optional boolean. Defaults to `true`; set to `false` to save JSON. |
| `headers` | Optional array of transaction keys to include in CSV output. Defaults to all keys from the first transaction. |

Returns the created file path, for example `transactions/2026-05-02T14-20.csv`.
