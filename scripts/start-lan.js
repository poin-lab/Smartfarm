process.env.HOST = "0.0.0.0";
process.env.PORT ||= "4100";
process.env.NODE_ENV ||= "development";
process.env.GREEN_LINK_LAN_MODE = "true";

await import("../server/index.js");
