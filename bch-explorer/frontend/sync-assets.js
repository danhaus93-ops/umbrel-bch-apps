const https = require("https");
const fsSync = require("fs");
const crypto = require("crypto");
const path = require("node:path");
const parseLinkHeader = require("parse-link-header");

// Configuration
const LOG_TAG = "[sync-assets]";
const CONFIG_FILE_NAME = "explorer-frontend-config.json";

const config = {
  verbose: parseInt(process.env.VERBOSE) === 1,
  explorerCDN: parseInt(process.env.EXPLORER_CDN) === 1,
  dryRun: parseInt(process.env.DRY_RUN) === 1,
  gitlabAccessToken: process.env.GITLAB_ACCESS_TOKEN,
};

// Early exit if SKIP_SYNC is set
if (parseInt(process.env.SKIP_SYNC) === 1) {
  console.log(`${LOG_TAG} SKIP_SYNC is set, not checking any assets`);
  process.exit(0);
}

// Log configuration
if (config.verbose)
  console.log(`${LOG_TAG} VERBOSE is set, logs will be more verbose`);
if (config.explorerCDN)
  console.log(
    `${LOG_TAG} EXPLORER_CDN is set, assets will be downloaded from bchexplorer.cash`
  );
if (config.dryRun)
  console.log(`${LOG_TAG} DRY_RUN is set, not downloading any assets`);

// Setup assets path
const ASSETS_PATH = (() => {
  if (!process.argv[2]) {
    throw new Error("Resource path argument is not set");
  }
  const rawPath = process.argv[2].endsWith("/")
    ? process.argv[2]
    : `${process.argv[2]}/`;
  const normalizedPath = path.resolve(path.normalize(rawPath));
  console.log(`${LOG_TAG} using ASSETS_PATH ${normalizedPath}`);

  if (!fsSync.existsSync(normalizedPath)) {
    console.log(`${LOG_TAG} ${normalizedPath} does not exist, creating`);
    fsSync.mkdirSync(normalizedPath, { recursive: true });
  }

  return normalizedPath;
})();

// Load frontend config
const loadConfig = () => {
  try {
    const rawConfig = fsSync.readFileSync(CONFIG_FILE_NAME, "utf8");
    console.log(
      `${LOG_TAG} ${CONFIG_FILE_NAME} file found, using provided config`
    );
    return JSON.parse(rawConfig);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    console.log(
      `${LOG_TAG} ${CONFIG_FILE_NAME} file not found, using default config`
    );
    return {};
  }
};

loadConfig();

// Utility: Make HTTPS request
const httpsRequest = (options) => {
  return new Promise((resolve, reject) => {
    https
      .get(options, (response) => {
        const chunks = [];

        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({ body, headers: response.headers });
        });
        response.on("error", reject);
      })
      .on("error", reject);
  });
};

// Utility: Download file
const downloadFile = (filePath, url) => {
  if (!filePath || !url) {
    if (config.verbose) {
      console.log("skipping malformed download request: ", filePath, url);
    }
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode < 200 || response.statusCode > 299) {
          reject(
            new Error(
              `HTTP Error ${response.statusCode} while fetching '${filePath}'`
            )
          );
          return;
        }

        const writeStream = fsSync.createWriteStream(filePath);
        response.pipe(writeStream);

        writeStream.on("finish", () => {
          if (config.verbose) {
            console.log(
              `${LOG_TAG} \tFinished downloading ${url} to ${filePath}`
            );
          }
          resolve();
        });

        writeStream.on("error", reject);
      })
      .on("error", reject);
  });
};

// Utility: Get local file hash (Git blob format)
const getLocalHash = (filePath) => {
  const stats = fsSync.statSync(filePath);
  const buffer = fsSync.readFileSync(filePath);
  const bufferWithHeader = Buffer.concat([
    Buffer.from("blob "),
    Buffer.from(`${stats.size}`),
    Buffer.from("\0"),
    buffer,
  ]);
  const hash = crypto.createHash("sha1").update(bufferWithHeader).digest("hex");

  if (config.verbose) {
    console.log(`${LOG_TAG} \t\tgetLocalHash ${filePath} ${hash}`);
  }

  return hash;
};

// Utility: Create GitLab API options
const createGitLabOptions = (projectId, page = 1) => {
  const options = {
    host: "gitlab.melroy.org",
    path: `/api/v4/projects/${projectId}/repository/tree?per_page=100&page=${page}`,
    method: "GET",
    headers: { "user-agent": "BCHExplorer/3.3" },
  };

  if (config.gitlabAccessToken) {
    options.headers["PRIVATE-TOKEN"] = config.gitlabAccessToken;
  }

  return options;
};

// Utility: Replace URL for CDN
const getCDNUrl = (url, replacePattern) => {
  return config.explorerCDN
    ? url.replace(replacePattern.from, replacePattern.to)
    : url;
};

// Utility: Ensure directory exists
const ensureDirectory = (dirPath) => {
  if (!fsSync.existsSync(dirPath)) {
    fsSync.mkdirSync(dirPath, { recursive: true });
  }
};

// Core: Process file item (handles checking and downloading)
const processFileItem = async (item, options) => {
  const {
    filePath,
    remoteHash,
    downloadUrl,
    cdnPattern,
    itemName,
    downloadDir,
  } = options;

  const fileExists = fsSync.existsSync(filePath);

  if (fileExists) {
    const localHash = getLocalHash(filePath);

    if (config.verbose) {
      console.log(`${LOG_TAG} \t\tremote ${itemName} hash ${remoteHash}`);
    }

    if (localHash !== remoteHash) {
      console.log(
        `${LOG_TAG} \t\t${itemName} is different on the remote, downloading...`
      );

      if (config.dryRun) {
        console.log(
          `${LOG_TAG} \t\tDRY_RUN is set, not downloading ${itemName} but we should`
        );
        return false;
      }

      const url = getCDNUrl(downloadUrl, cdnPattern);
      if (config.verbose) {
        console.log(`${LOG_TAG} \t\tDownloading ${url} to ${filePath}`);
      }
      await downloadFile(filePath, url);
      return true;
    } else {
      console.log(
        `${LOG_TAG} \t\t${itemName} is already up to date. Skipping.`
      );
      return false;
    }
  } else {
    console.log(`${LOG_TAG} \t\t${itemName} is missing, downloading...`);
    ensureDirectory(downloadDir);

    if (config.dryRun) {
      console.log(
        `${LOG_TAG} \t\tDRY_RUN is set, not downloading ${itemName} but we should`
      );
      return false;
    }

    const url = getCDNUrl(downloadUrl, cdnPattern);
    if (config.verbose) {
      console.log(`${LOG_TAG} \t\tDownloading ${url} to ${filePath}`);
    }
    await downloadFile(filePath, url);
    return true;
  }
};

// Core: Fetch GitHub directory contents
const fetchGitLabRepoTree = async (projectId, useAuth = false) => {
  if (useAuth && config.gitlabAccessToken) {
    console.log(`${LOG_TAG} \tDownloading with authentication`);
  }

  let allContents = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const options = createGitLabOptions(projectId, page);
    const response = await httpsRequest(options);
    const contents = JSON.parse(response.body.toString());

    if (contents.message) {
      throw new Error(contents.message);
    }

    allContents = allContents.concat(contents);

    // Parse Link header to check for next page
    const linkHeader = response.headers.link;
    if (linkHeader) {
      const parsedLinks = parseLinkHeader(linkHeader);
      hasNextPage = parsedLinks && parsedLinks.next;
    } else {
      hasNextPage = false;
    }

    if (config.verbose) {
      console.log(
        `${LOG_TAG} \tFetched page ${page}, got ${contents.length} items`
      );
    }

    page++;
  }

  if (config.verbose) {
    console.log(`${LOG_TAG} \tTotal items fetched: ${allContents.length}`);
  }

  return allContents;
};

// Main: Download mining pool logos
const downloadMiningPoolLogos = async () => {
  console.log(
    `${LOG_TAG} \tChecking if mining pool logos needs downloading or updating...`
  );

  try {
    const poolLogos = await fetchGitLabRepoTree(
      162,
      !!config.gitlabAccessToken
    );

    let downloadedCount = 0;
    const validFiles = poolLogos.filter(
      (item) => item.type === "blob" && item.name.endsWith(".svg")
    );

    if (config.verbose) {
      console.log(`${LOG_TAG} Total SVG files: ${validFiles.length}`);
    }

    for (const poolLogo of validFiles) {
      if (config.verbose) {
        console.log(`${LOG_TAG} Processing ${poolLogo.name}`);
      }

      const downloadUrl = `https://gitlab.melroy.org/bitcoincash/mining-pool-logos/-/raw/main/${poolLogo.name}`;

      const downloaded = await processFileItem(poolLogo, {
        filePath: `${ASSETS_PATH}/mining-pools/${poolLogo.name}`,
        remoteHash: poolLogo.id,
        downloadUrl: downloadUrl,
        cdnPattern: {
          from: "gitlab.melroy.org/bitcoincash/mining-pool-logos/-/raw/main",
          to: "bchexplorer.cash/resources/mining-pools",
        },
        itemName: poolLogo.name,
        downloadDir: `${ASSETS_PATH}/mining-pools/`,
      });

      if (downloaded) downloadedCount++;
    }

    console.log(
      `${LOG_TAG} \t\tDownloaded ${downloadedCount} and skipped ${validFiles.length - downloadedCount} existing mining pool logos`
    );
  } catch (e) {
    throw new Error(
      `Unable to download mining pool logos. Trying again at next restart. Reason: ${e instanceof Error ? e.message : e}`
    );
  }
};

// Main: Download promo video subtitles
const downloadPromoVideoSubtitles = async () => {
  console.log(
    `${LOG_TAG} \tChecking if promo video subtitles needs downloading or updating...`
  );

  try {
    const subtitles = await fetchGitLabRepoTree(0, !!config.gitlabAccessToken);

    let downloadedCount = 0;
    const validFiles = subtitles.filter(
      (item) => item.type === "blob" && item.name.endsWith(".vtt")
    );

    for (const subtitle of validFiles) {
      if (config.verbose) {
        console.log(`${LOG_TAG} Processing ${subtitle.name}`);
      }

      const downloadUrl = `https://gitlab.melroy.org/bitcoincash/mempool-promo/-/raw/main/subtitles/${subtitle.name}`;

      const downloaded = await processFileItem(subtitle, {
        filePath: `${ASSETS_PATH}/promo-video/subtitles/${subtitle.name}`,
        remoteHash: subtitle.id,
        downloadUrl: downloadUrl,
        cdnPattern: {
          from: "gitlab.melroy.org/bitcoincash/mempool-promo/-/raw/main/subtitles",
          to: "bchexplorer.cash/resources/promo-video",
        },
        itemName: subtitle.name,
        downloadDir: `${ASSETS_PATH}/promo-video/subtitles/`,
      });

      if (downloaded) downloadedCount++;
    }

    console.log(
      `${LOG_TAG} Downloaded ${downloadedCount} and skipped ${validFiles.length - downloadedCount} existing video subtitles`
    );
  } catch (e) {
    throw new Error(
      `Unable to download video subtitles. Trying again at next restart. Reason: ${e instanceof Error ? e.message : e}`
    );
  }
};

// Main: Download promo video
const downloadPromoVideo = async () => {
  console.log(
    `${LOG_TAG} \tChecking if promo video needs downloading or updating...`
  );

  try {
    const contents = await fetchGitLabRepoTree(0, !!config.gitlabAccessToken);

    const videoItem = contents.find((item) => item.name === "promo.mp4");
    if (!videoItem) {
      console.log(`${LOG_TAG} \tpromo.mp4 not found in repository`);
      return;
    }

    const downloadUrl = `https://gitlab.melroy.org/bitcoincash/mempool-promo/-/raw/main/promo.mp4`;

    const downloaded = await processFileItem(videoItem, {
      filePath: `${ASSETS_PATH}/promo-video/mempool-promo.mp4`,
      remoteHash: videoItem.id,
      downloadUrl: downloadUrl,
      cdnPattern: {
        from: "gitlab.melroy.org/bitcoincash/mempool-promo/-/raw/main/promo.mp4",
        to: "bchexplorer.cash/resources/promo-video/mempool-promo.mp4",
      },
      itemName: "mempool-promo.mp4",
      downloadDir: `${ASSETS_PATH}/promo-video/`,
    });
  } catch (e) {
    throw new Error(
      `Unable to download video. Trying again at next restart. Reason: ${e instanceof Error ? e.message : e}`
    );
  }
};

// Main execution
(async () => {
  try {
    // Download GitHub assets sequentially
    if (config.verbose) {
      console.log(`${LOG_TAG} Downloading mining pool logos`);
    }
    await downloadMiningPoolLogos();

    // if (config.verbose) {
    //   console.log(`${LOG_TAG} Downloading promo video subtitles`);
    // }
    // await downloadPromoVideoSubtitles();

    // if (config.verbose) {
    //   console.log(`${LOG_TAG} Downloading promo video`);
    // }
    // await downloadPromoVideo();

    console.log(`${LOG_TAG} Asset synchronization complete`);
  } catch (error) {
    console.error(`${LOG_TAG} Error:`, error.message);
    process.exit(1);
  }
})();
