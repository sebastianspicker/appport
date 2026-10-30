# Appport alpha: known issues

Thank you for testing Appport. This alpha is a private preview. Things will go wrong,
and your reports are how we find them. This page lists what we already know about
and what to do when you hit it.

## Before you start

- **The installer is not signed.** Windows may warn that the publisher is unknown.
  This is expected for the alpha.
- **Early live testing.** Appport's install and update requests have been checked
  carefully in development, but the alpha is the first time many of them run against
  the real software service. Expect rough edges, and please report anything
  surprising, even if it seems minor.

## What doesn't work yet, or may not

**Update notifications may not appear.** Appport checks for updates in the
background and should show a Windows notification when one is available. We haven't
yet confirmed this on an installed copy.
*Workaround:* open Appport and look at the **Updates** tab.

**A request can end with "The final result is unknown."** This happens when Appport
sent the request but could not confirm what happened, for example after a brief
network or server problem. The application stays locked so you can't send the same
request twice by accident.
*What to do:* don't try to request it again straight away. After about 15 minutes,
click **Check status**. If the software was installed, Appport shows it as
installed. If the service shows no request still in progress, Appport unlocks the
application and you can request it again. If it stays locked, send the action ID
shown on screen to your IT contact.

**Long installations pause their status checks.** After about five minutes,
Appport stops checking automatically and shows "Status checks paused."
*Workaround:* click **Resume status checks**. The installation itself carries on
in the background either way.

**The whole software list can fail to load.** If the service returns a single entry
Appport can't read, the list shows "Service unavailable" instead of the entries it
could read.
*What to do:* try again later, and send us a support bundle (see below). It tells us
which entry caused it.

**Some support details are always empty.** On the **Support** page, "Relution last
connection" and "Last MDM IP" always show "Not reported by Relution". This is a
known gap, not a problem with your PC.

**Reinstalling the same version after removing it may be refused.** If you uninstall
an application and then request the same version again, Appport may say a matching
request is already active. We haven't confirmed this yet. If it happens to you,
please report it.

## How to report a problem

Please include:

1. **What you did and what you expected**, in a sentence or two.
2. **When it happened**: date and approximate time. This lets us find the matching
   entries in the log.
3. **What you saw**: the exact message, or a screenshot. If an action ID is shown,
   copy it.
4. **A support bundle**: open **Support**, click **Generate support bundle**,
   confirm, then click **Open support folder** and attach the newest ZIP file.

The support bundle stays on your PC until you share it. It contains device details
(such as the device name, model and serial number) and Appport's own log, which now
records every failed request with its time. It does not contain your password,
access token, or the list of software installed on your PC. Share it only with the
person who invited you to the alpha.

Send reports to the person who invited you to the alpha.
