# Security Policy

## Privacy by design

DiffSense runs entirely on your machine. It makes no network requests, needs no account, and sends no telemetry, so your files never leave your computer. Reports that show this is not true are treated as security issues.

## Supported versions

Security fixes are made to the latest released version of the VS Code extension (`RazaTech.diffsense-vscode`) and the IntelliJ plugin (`com.razatech.diffsense`).

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately using GitHub's [private vulnerability reporting](https://github.com/shossain786/diff-sense/security/advisories/new) ("Report a vulnerability" on the repository's Security tab).

Useful things to include: what you found, how to reproduce it (a minimal input file is ideal), the affected version, and the impact you expect. Do not include real secrets or private code.

We aim to acknowledge a report within a few days and to publish a fix and a short advisory once it is resolved. You will be credited unless you prefer otherwise.

## Areas we care about most

* Anything that makes DiffSense read files it was not asked to compare, or send data off the machine
* Parser issues with untrusted input (JSON, YAML, XML, Java): crashes, hangs, excessive memory use, or XML external entity (XXE) handling
* Script injection through file contents in the extension's summary panel
