const express = require('express');
const path = require('path');
const fs = require('fs');

const webpack = require('webpack');
const webpackConfig = require('../config/webpack.config.js');
const compiler = webpack(webpackConfig('production'));
const webpackDevMiddleware = require('webpack-dev-middleware')(
    compiler, {
        noInfo: true,
        publicPath: webpackConfig.output.publicPath
    }
);

function getAssetManifest() {
    const content = webpackDevMiddleware.fileSystem.readFileSync(__dirname + '../build/asset-manifest.json');
    return JSON.parse(content);
}

const app = express();
app.use(express.static(path.resolve(__dirname, '../build')));
app.use(webpackDevMiddleware);
app.use(require('webpack-hot-middleware')(compiler, {
    log: console.log,
    path: '/__webpack_hmr',
    heartbeat: 10 * 1000
}));

app.post('/upload', (req, res) => {
    console.log(req.body);
    let buf = new buffer.Buffer(req.body);
    fs.writeFile('./test', buf, (err) => {
        console.log(err);
        res.send(JSON.stringify({ res: 'ok' }));
    });
});

app.get('/test', (req, res) => {
    res.send('hello');
})

module.exports = app;