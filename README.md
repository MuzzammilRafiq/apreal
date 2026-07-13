# Apreal

Apreal is a local-first AI agent that runs on your Mac and opens in your web browser and your phones browser.No need to setup telegram,WhatsApp etc.

## Download and install

The current release supports Apple Silicon.

```bash
curl -fL https://github.com/MuzzammilRafiq/apreal/releases/latest/download/install.sh -o /tmp/apreal-install.sh
sh /tmp/apreal-install.sh
```
The installer downloads Apreal, verifies the release checksum, installs its private runtimes under `~/.apreal`, and adds the `apreal` command to your shell path. Open a new terminal after installation.

## Use Apreal

Start Apreal:

```bash
apreal start
```

Your browser opens the Apreal interface automatically. On first use, open **Settings**, connect an AI provider with a subscription login or API key, and choose a model. You can then return to the chat and start a conversation.

Keep the terminal open while using Apreal. To stop it, press `Control-C` in that terminal.

If the browser does not open automatically, visit [http://localhost:3000](http://localhost:3000).

To control this agent via phone open [link](apreal-web.vercel.app) and login with same google account.

## Useful commands

```bash
apreal status   # Check whether Apreal is running
apreal logs     # Show server logs
apreal version  # Show the installed version
apreal stop     # Stop Apreal from another terminal
```

To install a newer release, run the installer again when an update is available.
