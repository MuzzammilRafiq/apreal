# Relay server deployment

The `Deploy relay server` GitHub Actions workflow builds and tests the relay, uploads its standalone artifact over SSH, runs the production tests on the host, activates it in the deploy directory, restarts the service, and optionally checks its public health endpoint.

## GitHub setup

Create a GitHub environment named `production`. Add an environment approval rule if deployments should require manual approval, then configure these environment values.

Variables:

- `RELAY_HOST`: SSH hostname or IP address.
- `RELAY_SSH_USER`: deployment user. Prefer a dedicated unprivileged user.
- `RELAY_SSH_PORT`: optional; defaults to `22`.
- `RELAY_DEPLOY_PATH`: optional; defaults to `/root/relay` for compatibility with the current manual deployment.
- `RELAY_HEALTHCHECK_URL`: optional HTTPS URL that returns a successful status when the relay is ready.

Secrets:

- `RELAY_DEPLOY_KEY`: the private half of a dedicated SSH key pair.
- `RELAY_KNOWN_HOSTS`: the server's pinned SSH host-key line, generated from a trusted machine with `ssh-keyscan -H <host>` and verified against the host itself.
- `RELAY_RESTART_COMMAND`: the command executed after activation, for example `sudo systemctl restart apreal-relay` or `pm2 restart apreal-relay`.

Do not put relay application secrets in GitHub. Keep the existing `.env` and durable SQLite/auth files on the host outside the deployed `src` and `node_modules` directories. The workflow deliberately replaces only `src`, `node_modules`, and `package.json`.

## Server setup

1. Install Node.js 24 (Node.js 22.5 or newer is required by `node:sqlite`) and ensure `node` and `npm` are available to non-interactive SSH sessions.
2. Add the public deployment key to the deployment user's `~/.ssh/authorized_keys`.
3. Give that user write access to `RELAY_DEPLOY_PATH` and permission to run only the required restart operation. For systemd, a narrow passwordless sudoers entry is preferable to SSH access as `root`.
4. Keep the service's working directory pointed at `RELAY_DEPLOY_PATH`; its start command remains `npm start`.

Pushes to `main` that change relay/shared code deploy automatically. Use **Actions → Deploy relay server → Run workflow** for an explicit deployment.
