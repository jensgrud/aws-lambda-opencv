var http = require('http');
var fs = require('fs');
var gulp = require('gulp');
var gutil = require('gulp-util');
var shell = require('gulp-shell');
var flatten = require('gulp-flatten');
var rename = require('gulp-rename');
var del = require('del');
var install = require('gulp-install');
var zip = require('gulp-zip');
var AWS = require('aws-sdk');
var runSequence = require('run-sequence');
var async = require('async');
var s3 = new AWS.S3();

var config;
try {
	config = require('./config.json');
} catch (ex) {
	config = {};
}

var build = './build';
var filename = '2.4.12.3';
var fileURL = 'http://github.com/Itseez/opencv/archive';
var extension = 'zip';

gulp.task('download-opencv', shell.task([
	' wget ' + fileURL + '/' + filename + '.' + extension 
]));

gulp.task('unzip-opencv', shell.task([
	'unzip ' + filename + '.' + extension + ' -d ' + build
]));

gulp.task('cmake-opencv', shell.task([
	'cd ' + build + '; cmake -D BUILD_PNG=OFF -D CMAKE_BUILD_TYPE=RELEASE -D BUILD_SHARED_LIBS=NO -D CMAKE_INSTALL_PREFIX=./opencv opencv-' + filename + '/'
]));

gulp.task('make-opencv', shell.task([
	'cd ' + build + '; make && make install'
]));

// Change path if needed - needs to be full
gulp.task('npm-opencv', shell.task([
	'cd ./build; PKG_CONFIG_PATH=~/aws-lambda-opencv/build/opencv/lib/pkgconfig/ npm install opencv'
]));

gulp.task('copy-opencv', function() {
	return gulp.src(['./node_modules/opencv/**/*'])
		.pipe(gulp.dest('./dist/node_modules/opencv'));
});

gulp.task('copy-haarcascade', function() {
	return gulp.src(['node_modules/opencv/data/haarcascade_frontalface_alt.xml'])
		.pipe(gulp.dest('./dist/'));
});

// First we need to clean out the dist folder and remove the compiled zip file.
gulp.task('clean', function(cb) {
	del([
		'./build/*',
		'./dist/*',
		'./dist.zip'
	], cb);
});

// The js task could be replaced with gulp-coffee as desired.
gulp.task('js', function() {
	return gulp.src(['index.js', 'config.json'])
		.pipe(gulp.dest('./dist'))
});

// Here we want to install npm packages to dist, ignoring devDependencies.
gulp.task('npm', function() {
	return gulp.src('./package.json')
		.pipe(gulp.dest('./dist'))
		.pipe(install({production: true}));
});

// Now the dist directory is ready to go. Zip it.
gulp.task('zip', function() {
	return gulp.src(['dist/**/*', '!dist/package.json', 'dist/.*'])
		.pipe(zip('dist.zip'))
		.pipe(gulp.dest('./'));
});

gulp.task('uploadLambda', function() {
  AWS.config.region = 'eu-west-1';
  var lambda = new AWS.Lambda();

  var functionName = 'aws-lamda-opencv-face-detection';
  fs.readFile('./dist.zip', function(err, data) {
        var current = data.Configuration;
    var params = {
      FunctionName: functionName,
        Publish: false,
        ZipFile: data
    };

    lambda.updateFunctionCode(params, function(err, data) {
	if (err) console.log(err, err.stack); // an error occurred
	else     console.log(data);           // successful response             
      });
    });
});

// Upload the function code to S3
gulp.task('upload', function(cb) {
	s3.upload({
		Bucket: config.bucket,
		Key: "aws-lamda-opencv-face-detection.zip",
		Body: fs.createReadStream('./dist.zip')
	}, cb);
});

gulp.task('default', function(cb) {
	return runSequence(
		['clean'],
		['download-opencv'],
		['unzip-opencv'],
		['cmake-opencv'],
		['make-opencv'],
		['npm-opencv'],
		['copy-opencv'],
		['copy-haarcascade', 'js', 'npm'],
		['zip'],
		['upload']
//		['uploadLambda'], issue with aws sdk and node 0.10.x https://github.com/aws/aws-sdk-js/issues/615,
		cb
	);
});
