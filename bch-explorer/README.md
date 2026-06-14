# BCH Explorer

Bitcoin Cash Explorer is a Bitcoin Cash-focused explorer, developed by Melroy van den Berg. It provides a comprehensive mempool visualizer, blockchain explorer, and API service, which powers [bchexplorer.cash](https://bchexplorer.cash).

Created and maintained by Melroy van den Berg, the BCH Explorer is fully open source under the AGPL license.

To support the continued development of this project, you can donate via Bitcoin Cash to: `bitcoincash:qzqmakefvntudp0fv7sunt5fjxdswlxv2yhezq7pdl`. Additional donation options are available on [my personal website](https://melroy.org/donate.html).

Looking ahead, I plan to introduce sponsorship opportunities to ensure the long-term sustainability of this project. This support will enable continued development and the addition of Bitcoin Cash-specific features and capabilities.

# Installation Methods

**Note:** Currently we are not yet listed on any of these "one-click installation" methods. For now, use the <a href="#advanced-installation-methods">Advanced Installation Methods</a>.

---

BCH Explorer can be self-hosted on a wide variety of your own hardware, ranging from a simple one-click installation on a Raspberry Pi full-node distro all the way to a robust production instance on a powerful Linux or FreeBSD server.

Most people should use a <a href="#one-click-installation">one-click install method</a>.

Other install methods are meant for developers and others with experience managing servers. If you want support for your own production instance of BCH Explorer.

We do **not** offer any paid Enterprise versions, everything is open-source and you will need to host it yourself, if you wish to run your own instance and having fun!

<a id="one-click-installation"></a>

## One-Click Installation

~~BCH Explorer can be conveniently installed on the following full-node distros:~~

<!-- - [Umbrel](https://github.com/getumbrel/umbrel)
- [StartOS](https://github.com/Start9Labs/start-os)
- [nix-bitcoin](https://github.com/fort-nix/nix-bitcoin/blob/a1eacce6768ca4894f365af8f79be5bbd594e1c3/examples/configuration.nix#L129)
- [myNode](https://github.com/mynodebtc/mynode)
-->

No matter which option you pick, you'll be able to get your own fully-sovereign instance of BCH Explorer up quickly without needing to fiddle with any settings.

## Advanced Installation Methods

BCH Explorer can be installed in other ways too, but we only recommend doing so if you're a developer, have experience managing servers, or otherwise know what you're doing.

- See the [`docker/`](./docker/) directory for instructions on deploying BCH Explorer with Docker.
- See the [`backend/`](./backend/) and [`frontend/`](./frontend/) directories for manual install instructions oriented for developers.
- See the [`production/`](./production/) directory for guidance on setting up a more serious BCH Explorer instance designed for high performance at scale.

## Translations

The BCH Explorer frontend is translated into 30+ different languages.

We use Localazy for translation management, go to: [https://localazy.com/p/bch-explorer](https://localazy.com/p/bch-explorer) and help us improve the translations!
