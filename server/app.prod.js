const express = require('express');
const path = require('path');
const fs = require('fs');
const buffer = require('buffer');
const { SplitChunksPlugin } = require('webpack');
const bodyParser = require('body-parser');
const formidable = require('formidable');
const { resolve } = require('path');

const app = express();
const assetManifest = require(path.resolve(__dirname, '../build/asset-manifest.json'));
const SliceSize = 1024 * 1024;

app.use(bodyParser.urlencoded({ limit: '2mb', extended: true }));
app.use(bodyParser.json({ limit: '2mb' }));
app.use(bodyParser.text({ limit: '2mb' }));

app.use(express.static(path.resolve(__dirname, '../build')));

let fileCache = {};
let timeoutTimerForFileCache = {};
const timeoutTime = 1000 * 60 * 60 * 24 * 3;

//add new mapping to hashToFilenameMapping.txt
function addMapping(hash, filename) {
    let map = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../upload/hashToFilenameMapping.json')).toString());
    map[hash] = filename;
    fs.writeFileSync(path.resolve(__dirname, '../upload/hashToFilenameMapping.json'), JSON.stringify(map));
}

//从记录中查找hash对应的文件
function findHash(hash) {
    let map = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../upload/hashToFilenameMapping.json')).toString());
    return map[hash] || false;
}

async function mergeSlice(hash, targetFilename, callback) {
    let errorIndex = [];
    await Promise.all(fileCache[hash].map((slice, index) => {
        return new Promise((resolve, reject) => {
            let write = fs.createWriteStream(path.resolve(__dirname, '../upload/' + targetFilename), {
                start: index * SliceSize,
            })
            let read = fs.createReadStream(slice.path);
            read.on('error', (err) => {
                errorIndex.push(i);
                resolve();
            });
            read.on('end', () => {
                resolve();
            })
            read.pipe(write);
        })
    }));
    callback(errorIndex);
}


app.post('/upload', (req, res) => {
    const form = new formidable.IncomingForm();
    const fileKey = 'file'; //files字段中的文件的key为fileKey
    form.parse(req, (err, fields, files) => {
        if (err) {
            console.log(err);
            res.status(400);
            res.end();
            return;
        }
        if (fields.finish) { //合并切片
            const hash = fields.hash;
            const filename = `${fields.hash.slice(0,10)}.${fields.name}`;

            mergeSlice(hash, filename, (errorIndex) => {
                if (errorIndex.length != 0) {
                    res.status(100);
                    res.end(JSON.stringify({ errorIndex }));
                } else {
                    res.status(200);
                    res.end();
                    //上传完成，删除fileCache和过期定时器
                    delete fileCache[hash];
                    clearTimeout(timeoutTimerForFileCache[hash]);
                    delete timeoutTimerForFileCache[hash];
                    addMapping(hash, filename);
                }
            })
        } else if (typeof fields.index === 'undefined') {
            //取hash前十位加.filename作为新文件名
            const filename = `${fields.hash.slice(0,10)}.${fields.name}`;
            fs.renameSync(files[fileKey].path, path.resolve(__dirname, '../upload/' + filename));
            addMapping(fields.hash, filename);
            res.status(200);
            res.end();
        } else {
            const hash = fields.hash;
            if (typeof fileCache[hash] === 'undefined') {
                res.status(500);
                res.end();
                return;
            }
            fileCache[hash][parseInt(fields.index)] = files[fileKey];
            res.status(200);
            res.end();
        }
    });
});

app.get('/upload', (req, res) => {
    res.setHeader('cache', 'no-cahce');
    if (!req.query.hash || !req.query.sliceNum) {
        res.status(400);
        res.end();
    }
    const hash = req.query.hash;
    if (findHash(hash)) {
        res.send(JSON.stringify({ needUpload: false }));
        return;
    }
    if (fileCache[hash]) { //has uploaded some slices of the file
        //过期定时器重新计时
        clearTimeout(timeoutTimerForFileCache[hash]);
        timeoutTimerForFileCache[hash] = setTimeout(() => {
            const _hash = hash;
            delete fileCache[_hash];
        }, timeoutTime);

        let needUpload = [];
        for (let i = 0; i < fileCache[hash].length; ++i) {
            if (!fileCache[hash][i]) {
                needUpload.push(i);
            }
        }
        res.send(JSON.stringify({
            needUpload: true,
            needUploadedIndex: needUpload,
        }));
        return;
    }
    fileCache[hash] = new Array(req.query.sliceNum);
    //过期定时器，到期将清除未上传完毕的文件块

    let timmer = setTimeout(() => {
        console.log('clear cache: ' + hash);
        const _hash = hash;
        delete fileCache[_hash];
    }, timeoutTime);
    timeoutTimerForFileCache[hash] = timmer;
    res.send(JSON.stringify({ needUpload: true }));
});

module.exports = app;