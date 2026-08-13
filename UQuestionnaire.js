const PLUGIN_NAME = "UQuestionnaire";
const VERSION = [0, 1, 4];
const PREFIX = "§e§l[问卷]§r ";
const DIR_PATH = "plugins/" + PLUGIN_NAME;

if (!File.exists(DIR_PATH)) File.mkdir(DIR_PATH);

const DEFAULT_CONFIG = {
    pushProbability: 0.5,
    pushDelayMs: 10000,
    economy: {
        type: "scoreboard",
        sbName: "money"
    }
};

const configPath = DIR_PATH + "/config.json";
if (File.exists(configPath)) {
    let rawContent = File.readFrom(configPath);
    try {
        JSON.parse(rawContent);
    } catch (e) {
        logger.error("检测到 config.json 存在语法错误！已重置。");
        File.writeTo(DIR_PATH + "/config_error_backup.json", rawContent || "");
        File.writeTo(configPath, JSON.stringify(DEFAULT_CONFIG, null, 4));
    }
}
const config = new JsonConfigFile(configPath, JSON.stringify(DEFAULT_CONFIG));

function deepMerge(target, source) {
    let modified = false;
    for (let key in source) {
        if (target[key] === undefined) {
            target[key] = source[key];
            modified = true;
        } else if (typeof source[key] === "object" && !Array.isArray(source[key]) && source[key] !== null) {
            if (typeof target[key] !== "object") {
                target[key] = {};
                modified = true;
            }
            if (deepMerge(target[key], source[key])) modified = true;
        }
    }
    return modified;
}

for (let key in DEFAULT_CONFIG) {
    let val = config.get(key);
    if (val === null || val === undefined) {
        config.set(key, DEFAULT_CONFIG[key]);
    } else if (typeof val === "object" && !Array.isArray(val)) {
        if (deepMerge(val, DEFAULT_CONFIG[key])) config.set(key, val);
    }
}

const defaultQuestions = {
    "list": {
        "sample_q1": {
            "title": "服务器游戏体验调查问卷",
            "startTime": "2024-01-01 00:00:00",
            "endTime": "2099-12-31 23:59:59",
            "conditions": { "scoreboardsMin": { "level": 1 }, "scoreboardsMax": {}, "onlineTimeMin": 0, "onlineTimeMax": null },
            "push": true,
            "visible": true,
            "rewards": { "money": 500, "items": [], "cmds": ["tellraw %name% {\"rawtext\":[{\"text\":\"感谢参与体验问卷！\"}]}"] },
            "allowMultiple": false,
            "questions": [
                {
                    "id": "q1",
                    "type": "single",
                    "title": "您对服务器的整体体验满意吗？",
                    "options": ["非常满意", "满意", "一般", "不满意", "垃圾"],
                    "required": true
                },
                {
                    "id": "q2",
                    "type": "text",
                    "title": "请说明您觉得体验差的原因：",
                    "required": true,
                    "dependsOn": { "qId": "q1", "contains": ["不满意", "垃圾"] }
                }
            ]
        }
    }
};

const questionsPath = DIR_PATH + "/questions.json";
if (!File.exists(questionsPath)) {
    File.writeTo(questionsPath, JSON.stringify(defaultQuestions, null, 4));
}
const questionsDb = new JsonConfigFile(questionsPath);
const statusDb = new JsonConfigFile(DIR_PATH + "/status.json", "{}");

let ansDb = new KVDatabase(DIR_PATH + "/answers_db");
if (!ansDb) {
    logger.fatal("KVDatabase 初始化失败！");
}

ll.onUnload(() => { 
    if (ansDb) { ansDb.close(); ansDb = null; } 
});


function parseTime(str) {
    if(!str || str.trim() === "") return null;
    let t = new Date(str.replace(/-/g, '/')).getTime();
    return isNaN(t) ? null : t;
}

const Eco = {
    cfg: config.get("economy"),
    add: function(player, amount) {
        amount = Math.floor(amount);
        if (amount <= 0) return true;
        
        if (this.cfg.type === "llmoney") {
            if (typeof money !== 'undefined') return money.add(player.xuid, amount);
            return false;
        } else {
            let s = player.getScore(this.cfg.sbName);
            let current = (typeof s === 'number' && !isNaN(s)) ? s : 0;
            
            let res = player.setScore(this.cfg.sbName, current + amount);
            if (res === false) {
                res = player.setScore(this.cfg.sbName, current + amount);
            }
            return res === true;
        }
    }
};

function checkConditions(pl, conditions) {
    if (!conditions) return true;

    let sbMin = conditions.scoreboardsMin || conditions.scoreboards || {};
    for (let sb in sbMin) {
        let req = sbMin[sb];
        let sc = pl.getScore(sb);
        let val = (sc == null || isNaN(sc)) ? 0 : sc;
        if (val < req) return false;
    }

    let sbMax = conditions.scoreboardsMax || {};
    for (let sb in sbMax) {
        let req = sbMax[sb];
        let sc = pl.getScore(sb);
        let val = (sc == null || isNaN(sc)) ? 0 : sc;
        if (val >= req) return false;
    }
    
    let minTime = conditions.onlineTimeMin !== undefined ? conditions.onlineTimeMin : (conditions.onlineTime || 0);
    let maxTime = conditions.onlineTimeMax;
    
    if (minTime > 0 || (maxTime !== undefined && maxTime !== null && maxTime !== "")) {
        let getOnlineTimeApi = ll.import("UEssential", "getOnlineTime");
        if (!getOnlineTimeApi) return false; 
        
        let pTime = getOnlineTimeApi(pl.xuid);
        if (pTime == null || typeof pTime !== "number") return false;
        
        if (minTime > 0 && pTime < minTime) return false;
        if (maxTime !== undefined && maxTime !== null && maxTime !== "") {
            if (pTime >= parseFloat(maxTime)) return false;
        }
    }

    return true;
}

function checkDepends(answersObj, dependsOn) {
    if (!dependsOn) return true;
    let targetAns = answersObj[dependsOn.qId];
    if (!targetAns) return false;
    
    if (dependsOn.contains) {
        for (let keyword of dependsOn.contains) {
            if (targetAns.includes(keyword)) return true;
        }
        return false;
    }
    return true;
}

function checkQuestionnaireAvailability(pl, qId, qData) {
    let now = Date.now();
    let status = statusDb.get(pl.xuid) || {};
    
    if (!qData.allowMultiple && status[qId]) return false;
    
    let st = parseTime(qData.startTime);
    let et = parseTime(qData.endTime);
    if (st && now < st) return false;
    if (et && now > et) return false;
    
    if (!checkConditions(pl, qData.conditions)) return false;
    
    return true;
}


function saveProgress(pl, qId, qData, qIndex, answersObj) {
    let qHash = data.toMD5(JSON.stringify(qData.questions));
    let progressData = {
        hash: qHash,
        answers: answersObj,
        currentIndex: qIndex
    };
    ansDb.set(`progress|${qId}|${pl.xuid}`, JSON.stringify(progressData));
}

function sendMultiChoice(pl, surveyTitle, q, selected, callback) {
    let maxStr = q.maxSelect ? `，最多选 ${q.maxSelect} 项` : "";
    let fm = mc.newSimpleForm().setTitle(surveyTitle)
        .setContent(q.title + `\n(已选 ${selected.length} 项${maxStr})`);
        
    fm.addButton("§a[确认提交本题]");
    q.options.forEach((opt, idx) => {
        let isSel = selected.includes(idx);
        fm.addButton(`${isSel ? "§2[√]" : "§8[ ]"} ${opt}`);
    });
    
    pl.sendForm(fm, (p, id) => {
        if (id == null) { callback(null); return; }
        if (id === 0) { 
            if (q.required && selected.length === 0) {
                p.tell(PREFIX + "§c此题为必答题，请至少选择一项！");
                sendMultiChoice(p, surveyTitle, q, selected, callback);
                return;
            }
            let ans = selected.map(i => q.options[i]).join("|");
            callback(ans);
            return;
        }
        
        let optIdx = id - 1;
        let sIdx = selected.indexOf(optIdx);
        if (sIdx !== -1) {
            selected.splice(sIdx, 1);
        } else {
            if (q.maxSelect && selected.length >= q.maxSelect) {
                p.tell(PREFIX + `§c限制：您最多只能选择 ${q.maxSelect} 项！`);
            } else {
                selected.push(optIdx);
            }
        }
        sendMultiChoice(p, surveyTitle, q, selected, callback);
    });
}

function askQuestion(pl, qId, qData, qIndex, answersObj, onComplete) {
    if (qIndex >= qData.questions.length) {
        onComplete(answersObj);
        return;
    }
    
    let q = qData.questions[qIndex];
    
    if (q.dependsOn && !checkDepends(answersObj, q.dependsOn)) {
        askQuestion(pl, qId, qData, qIndex + 1, answersObj, onComplete);
        return;
    }
    
    if (q.type === "single") {
        let fm = mc.newCustomForm().setTitle(qData.title)
            .addDropdown(q.title, q.options, 0);
            
        pl.sendForm(fm, (p, data) => {
            if (!data) { 
                saveProgress(p, qId, qData, qIndex, answersObj);
                p.tell(PREFIX + "§e操作中止，您的作答进度已自动保存。"); 
                return; 
            }
            answersObj[q.id] = q.options[data[0]];
            askQuestion(p, qId, qData, qIndex + 1, answersObj, onComplete);
        });
        
    } else if (q.type === "multi") {
        sendMultiChoice(pl, qData.title, q, [], (ans) => {
            if (ans == null) { 
                saveProgress(pl, qId, qData, qIndex, answersObj);
                pl.tell(PREFIX + "§e操作中止，您的作答进度已自动保存。"); 
                return; 
            }
            answersObj[q.id] = ans;
            askQuestion(pl, qId, qData, qIndex + 1, answersObj, onComplete);
        });
        
    } else if (q.type === "text") {
        let fm = mc.newCustomForm().setTitle(qData.title)
            .addLabel(q.title)
            .addInput("请输入您的回答：", "在此输入", "");
            
        pl.sendForm(fm, (p, data) => {
            if (!data) { 
                saveProgress(p, qId, qData, qIndex, answersObj);
                p.tell(PREFIX + "§e操作中止，您的作答进度已自动保存。"); 
                return; 
            }
            let val = data[1].trim();
            if (q.required && val === "") {
                p.tell(PREFIX + "§c此题为必答题，请勿留空！");
                askQuestion(p, qId, qData, qIndex, answersObj, onComplete);
                return;
            }
            answersObj[q.id] = val;
            askQuestion(p, qId, qData, qIndex + 1, answersObj, onComplete);
        });
        
    } else if (q.type === "rating") {
        let fm = mc.newCustomForm().setTitle(qData.title)
            .addLabel(q.title + `\n§7(允许打分范围: ${q.min} - ${q.max})§r`)
            .addInput("请输入您的评分(整数)：", "纯数字", "");
            
        pl.sendForm(fm, (p, data) => {
            if (!data) { 
                saveProgress(p, qId, qData, qIndex, answersObj);
                p.tell(PREFIX + "§e操作中止，您的作答进度已自动保存。"); 
                return; 
            }
            let valStr = data[1].trim();
            if (q.required && valStr === "") {
                p.tell(PREFIX + "§c此题为必答题，请勿留空！");
                askQuestion(p, qId, qData, qIndex, answersObj, onComplete);
                return;
            }
            if (valStr !== "") {
                let val = parseInt(valStr);
                if (isNaN(val) || val < q.min || val > q.max || val.toString() !== valStr) {
                    p.tell(PREFIX + `§c格式错误：请输入 ${q.min} 到 ${q.max} 之间的有效整数！`);
                    askQuestion(p, qId, qData, qIndex, answersObj, onComplete);
                    return;
                }
                answersObj[q.id] = val.toString();
            } else {
                answersObj[q.id] = "";
            }
            askQuestion(p, qId, qData, qIndex + 1, answersObj, onComplete);
        });
    }
}

function startQuestionnaire(pl, qId, qData) {
    let progStr = ansDb.get(`progress|${qId}|${pl.xuid}`);
    if (progStr) {
        let prog = JSON.parse(progStr);
        let currentHash = data.toMD5(JSON.stringify(qData.questions));
        if (prog.hash === currentHash) {
            let fm = mc.newSimpleForm().setTitle("继续作答")
                .setContent(`系统检测到您有未完成的作答进度（已完成 ${Object.keys(prog.answers).length} 题），是否从上次进度继续？`)
                .addButton("继续上次作答")
                .addButton("删除进度重新开始");
            pl.sendForm(fm, (p, id) => {
                if (id == null) return;
                if (id === 0) {
                    askQuestion(p, qId, qData, prog.currentIndex, prog.answers, (ansObj) => {
                        finishQuestionnaire(p, qId, qData, ansObj);
                    });
                } else {
                    ansDb.delete(`progress|${qId}|${p.xuid}`);
                    askQuestion(p, qId, qData, 0, {}, (ansObj) => {
                        finishQuestionnaire(p, qId, qData, ansObj);
                    });
                }
            });
            return;
        } else {
            ansDb.delete(`progress|${qId}|${pl.xuid}`);
        }
    }
    askQuestion(pl, qId, qData, 0, {}, (ansObj) => {
        finishQuestionnaire(pl, qId, qData, ansObj);
    });
}


function grantRewards(pl, rewards) {
    if (!rewards) return;
    if (rewards.money > 0) {
        if (!Eco.add(pl, rewards.money)) {
            logger.error(`发奖失败：未能成功将金钱汇入 ${pl.realName} 的账户中，请检查经济核心是否正常工作。`);
        } else {
            pl.tell(PREFIX + `§a奖励发放：已将 ${rewards.money} 资金汇入您的账户。`);
        }
    }
    if (rewards.items && rewards.items.length > 0) {
        let inv = pl.getInventory();
        for (let snbt of rewards.items) {
            let comp = NBT.parseSNBT(snbt);
            if (comp) {
                let item = mc.newItem(comp);
                if (item && !item.isNull()) {
                    if (inv.hasRoomFor(item)) inv.addItemToFirstEmptySlot(item);
                    else mc.spawnItem(item, pl.pos);
                }
                comp.destroy();
            }
        }
        pl.refreshItems();
        pl.tell(PREFIX + `§a奖励发放：实体物资包裹已结算。`);
    }
    if (rewards.cmds && rewards.cmds.length > 0) {
        for (let cmd of rewards.cmds) {
            mc.runcmd(cmd.replace(/%name%/g, `"${pl.realName}"`));
        }
    }
}

function finishQuestionnaire(pl, qId, qData, answersObj) {
    ansDb.delete(`progress|${qId}|${pl.xuid}`);
    
    let dv = pl.getDevice();
    let ip = dv ? (dv.ip.split(':')[0] || "Unknown") : "Unknown";
    
    let ansId = `${qId}|${pl.xuid}|${Date.now()}`;
    let record = {
        xuid: pl.xuid,
        name: pl.realName,
        time: system.getTimeStr(),
        ip: ip,
        answers: answersObj
    };
    ansDb.set(ansId, JSON.stringify(record));
    
    let status = statusDb.get(pl.xuid) || {};
    let isFirst = !status[qId]; 
    
    status[qId] = true;
    statusDb.set(pl.xuid, status);
    
    if (isFirst) {
        grantRewards(pl, qData.rewards);
        pl.tell(PREFIX + "§a万分感谢您的作答！提交奖励已下发完毕。");
    } else {
        pl.tell(PREFIX + "§a感谢您的补充作答！(注意：重复提交不包含额外奖励)");
    }
}


mc.listen("onJoin", (player) => {
    if (player.isSimulatedPlayer()) return;
    
    setTimeout(() => {
        let pl = mc.getPlayer(player.xuid);
        if (!pl) return;
        
        let prob = config.get("pushProbability");
        if (prob == null) prob = 0.5;
        if (Math.random() > prob) return;
        
        let avails = [];
        let qMap = questionsDb.get("list") || {};
        for (let qId in qMap) {
            let q = qMap[qId];
            if (q.push === false) continue; 
            if (checkQuestionnaireAvailability(pl, qId, q)) {
                avails.push({ id: qId, data: q });
            }
        }
        
        if (avails.length > 0) {
            let targetQ = avails[0];
            ansDb.set(`pushed|${targetQ.id}|${pl.xuid}`, "1");
            pl.sendModalForm("§l调查问卷推送通知", `服务器为您匹配了一份新的调查问卷：\n\n§e${targetQ.data.title}§r\n\n是否现在立刻前往填写并获取提交奖励？`, "马上前往", "以后再说", (p, res) => {
                if (res) startQuestionnaire(p, targetQ.id, targetQ.data);
            });
        }
    }, config.get("pushDelayMs") || 10000);
});

function sendPlayerMenu(pl) {
    let avails = [];
    let qMap = questionsDb.get("list") || {};
    for (let qId in qMap) {
        let q = qMap[qId];
        if (q.visible === false) continue;
        if (checkQuestionnaireAvailability(pl, qId, q)) {
            avails.push({ id: qId, data: q });
        }
    }
    
    if (avails.length === 0) {
        pl.tell(PREFIX + "§e您目前没有需要填写的问卷，或者您不符合推送目标要求。");
        return;
    }
    
    let fm = mc.newSimpleForm().setTitle("问卷中心").setContent("请选择你要填写的问卷模块：");
    avails.forEach(q => fm.addButton(q.data.title));
    
    pl.sendForm(fm, (p, id) => {
        if (id == null) return;
        let targetQ = avails[id];
        startQuestionnaire(p, targetQ.id, targetQ.data);
    });
}

function sendAdminMenu(pl) {
    let fm = mc.newSimpleForm().setTitle("问卷管理系统")
        .addButton("刷新重载配置信息")
        .addButton("调取并导出答卷数据汇总")
        .addButton("清理无效的问卷作答记录")
        .addButton("预览问卷基础统计信息");
        
    pl.sendForm(fm, (p, id) => {
        if (id === 0) {
            questionsDb.reload();
            p.tell(PREFIX + "§a已成功将磁盘中的 questions.json 更新至运行内存！");
        } else if (id === 1) {
            sendAdminExportMenu(p);
        } else if (id === 2) {
            cleanUpOrphanData(p);
        } else if (id === 3) {
            sendAdminPreviewList(p);
        }
    });
}

function previewStats(admin, qId, qData) {
    let keys = ansDb.listKey();
    let totalSubmissions = 0;
    let completed = new Set();
    let pushed = new Set();

    let qPrefix = qId + "|";
    let pushPrefix = "pushed|" + qId + "|";

    for (let k of keys) {
        if (k.startsWith(qPrefix)) {
            totalSubmissions++;
            let parts = k.split("|");
            if (parts.length >= 2) completed.add(parts[1]);
        } else if (k.startsWith(pushPrefix)) {
            let parts = k.split("|");
            if (parts.length >= 3) pushed.add(parts[2]);
        }
    }

    let pushCount = pushed.size;
    let compCount = completed.size;
    let rateStr = "0.00%";

    if (pushCount > 0) {
        rateStr = ((compCount / pushCount) * 100).toFixed(2) + "%";
    } else if (compCount > 0) {
        rateStr = "100.00% (皆为玩家主动探索填写)";
    }

    let content = `§e问卷名称：§r${qData.title}\n` +
                  `§e问卷ID：§r${qId}\n` +
                  `§e-------------------§r\n` +
                  `§b总计填写份数：§r${totalSubmissions} 份\n` +
                  `§b已填写的独立玩家：§r${compCount} 人\n` +
                  `§b被推送的独立玩家：§r${pushCount} 人\n` +
                  `§a玩家填写意愿：§r${rateStr}`;

    let fm = mc.newSimpleForm().setTitle("问卷基础统计预览").setContent(content).addButton("返回上级菜单");
    admin.sendForm(fm, (pl, id) => {
        if (id === 0) sendAdminPreviewList(pl);
    });
}

function sendAdminPreviewList(pl) {
    let qMap = questionsDb.get("list") || {};
    let qIds = Object.keys(qMap);
    if (qIds.length === 0) {
        pl.tell(PREFIX + "§e目前系统中尚未部署任何可用的调查问卷配置。");
        return;
    }
    
    let fm = mc.newSimpleForm().setTitle("选择预览问卷").setContent("请点击要查看基础统计信息的问卷：");
    qIds.forEach(k => fm.addButton(qMap[k].title + `\n§8(${k})§r`));
    
    pl.sendForm(fm, (p, id) => {
        if (id == null) return;
        previewStats(p, qIds[id], qMap[qIds[id]]);
    });
}

function cleanUpOrphanData(admin) {
    let qMap = questionsDb.get("list") || {};
    let validQIds = Object.keys(qMap);
    let keys = ansDb.listKey();
    let deleteCount = 0;
    
    for (let k of keys) {
        let parts = k.split("|");
        let qId = parts[0];
        
        if (parts[0] === "progress" || parts[0] === "pushed") {
            qId = parts[1];
        }
        
        if (!validQIds.includes(qId)) {
            ansDb.delete(k);
            deleteCount++;
        }
    }
    
    admin.tell(PREFIX + `§a清理完毕！共清除了 ${deleteCount} 条无效或已被移出配置文件的问卷相关记录。`);
}

function exportCSV(admin, qId, qData) {
    let keys = ansDb.listKey();
    let records = [];
    let queryPrefix = `${qId}|`;
    
    for (let k of keys) {
        if (k.startsWith(queryPrefix)) {
            let r = ansDb.get(k);
            if (r) records.push(JSON.parse(r));
        }
    }
    
    if (records.length === 0) {
        admin.tell(PREFIX + "§c导出受阻：该问卷目前没有任何已完成的作答归档记录。");
        return;
    }
    
    let escape = (str) => {
        if (str == null) return '""';
        return `"${String(str).replace(/"/g, '""')}"`;
    };

    let csv = "Time,Player,XUID,IP,";
    let headers = qData.questions.map(q => `${q.title} (${q.type}) [${q.id}]`);
    csv += headers.map(escape).join(",") + "\n";
    
    let qIds = qData.questions.map(q => q.id);
    
    for (let rec of records) {
        let row = [rec.time, rec.name, rec.xuid, rec.ip || "Unknown"];
        for (let qid of qIds) {
            row.push(rec.answers[qid] || "N/A (未触碰分支)");
        }
        csv += row.map(escape).join(",") + "\n";
    }
    
    let exportDir = DIR_PATH + "/export";
    if (!File.exists(exportDir)) File.mkdir(exportDir);
    let path = `${exportDir}/Report_${qId}_${Date.now()}.csv`;
    File.writeTo(path, csv);
    admin.tell(PREFIX + `§a归档成功！生成的答卷汇总 CSV 文件已保存至服务器本地的：\n${path}`);
}

function sendAdminExportMenu(pl) {
    let qMap = questionsDb.get("list") || {};
    let qIds = Object.keys(qMap);
    if (qIds.length === 0) {
        pl.tell(PREFIX + "§e目前系统中尚未部署任何可用的调查问卷配置。");
        return;
    }
    
    let fm = mc.newSimpleForm().setTitle("导出门类选择").setContent("请点击要下发成表格的源问卷：");
    qIds.forEach(k => fm.addButton(qMap[k].title + `\n§8(${k})§r`));
    
    pl.sendForm(fm, (p, id) => {
        if (id == null) return;
        exportCSV(p, qIds[id], qMap[qIds[id]]);
    });
}

mc.listen("onServerStarted", () => {
    let cmd = mc.newCommand("wj", "调查问卷系统后台与主菜单", PermType.Any);
    
    cmd.setEnum("UWJ_Action", ["admin", "export", "cleanup", "fill"]);
    cmd.optional("action", ParamType.Enum, "UWJ_Action", "UWJ_Action", 1);
    cmd.optional("param", ParamType.String);
    cmd.overload([]);
    cmd.overload(["action"]);
    cmd.overload(["action", "param"]);
    
    cmd.setCallback((cmd, origin, out, results) => {
        if (!origin.player || origin.player.isSimulatedPlayer()) return;
        let pl = origin.player;
        let act = results.action;
        
        if (act === "admin") {
            if (pl.isOP()) {
                sendAdminMenu(pl);
            } else {
                pl.tell(PREFIX + "§c权限鉴定：您不属于拥有管理员身份的运维人员！");
            }
        } else if (act === "export") {
            if (pl.isOP()) {
                if (results.param) {
                    let qMap = questionsDb.get("list") || {};
                    let qData = qMap[results.param];
                    if (qData) {
                        exportCSV(pl, results.param, qData);
                    } else {
                        pl.tell(PREFIX + "§c找不到指定的问卷ID，导出流程受阻！");
                    }
                } else {
                    sendAdminExportMenu(pl);
                }
            } else {
                pl.tell(PREFIX + "§c权限鉴定：您不属于拥有管理员身份的运维人员！");
            }
        } else if (act === "cleanup") {
            if (pl.isOP()) {
                cleanUpOrphanData(pl);
            } else {
                pl.tell(PREFIX + "§c权限鉴定：您不属于拥有管理员身份的运维人员！");
            }
        } else if (act === "fill") {
            if (results.param) {
                let qMap = questionsDb.get("list") || {};
                let qData = qMap[results.param];
                if (qData) {
                    if (checkQuestionnaireAvailability(pl, results.param, qData)) {
                        startQuestionnaire(pl, results.param, qData);
                    } else {
                        pl.tell(PREFIX + "§c您当前不符合该问卷的填写条件，或该问卷已过期/已填写过。");
                    }
                } else {
                    pl.tell(PREFIX + "§c找不到指定的问卷ID！");
                }
            } else {
                pl.tell(PREFIX + "§c指令用法：/wj fill [问卷id]");
            }
        } else {
            sendPlayerMenu(pl);
        }
    });
    cmd.setup();
});

logger.setTitle(PLUGIN_NAME);
logger.info(`${PLUGIN_NAME} v${VERSION.join(".")} 载入就绪。作者：wuw111，插件反馈QQ群：1097933637`);