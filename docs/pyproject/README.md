<!-- This README is the short description shown on PyPI -->

<p align=center>
  <br>
  <strong>QGI Life-Signals-IQ</strong>
  <br>
  <em>Username Intelligence Across 400+ Social Networks</em>
  <br>
  <sub>Soft rebrand of the <a href="https://github.com/sherlock-project/sherlock">Sherlock Project</a></sub>
  <br><br>
</p>

## Usage

```console
$ qgi-life-signals-iq --help
usage: qgi-life-signals-iq [-h] [--version] [--verbose] [--folderoutput FOLDEROUTPUT]
                [--output OUTPUT] [--tor] [--unique-tor] [--csv] [--xlsx]
                [--site SITE_NAME] [--proxy PROXY_URL] [--json JSON_FILE]
                [--timeout TIMEOUT] [--print-all] [--print-found] [--no-color]
                [--browse] [--local] [--nsfw]
                USERNAMES [USERNAMES ...]
```

To search for only one user:
```bash
$ qgi-life-signals-iq user123
```

To search for more than one user:
```bash
$ qgi-life-signals-iq user1 user2 user3
```

The legacy `sherlock` command name remains available as an alias.
