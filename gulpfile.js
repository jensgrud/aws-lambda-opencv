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
var filename = '3.1.0';
var fileURL = 'http://github.com/Itseez/opencv/archive';
var extension = 'zip';

gulp.task('postinstall', function(cb) {
	async.reject(
		['config.json', 'test_event.json'],
		fs.exists,
		function(files) {
			async.map(files, function(file, cb) {
				return cb(null, gulp.src(file.replace(/\.json/, '_sample.json'))
						.pipe(rename(file))
						.pipe(gulp.dest('.'))
				);
			}, cb);
		}
	);
});

gulp.task('download-opencv', shell.task([
	' wget ' + fileURL + '/' + filename + '.' + extension 
]));

// Resorting to using a shell task. Tried a number of other things including
// LZMA-native, node-xz, decompress-tarxz. None of them work very well with this.
// This will probably work well for OS X and Linux, but maybe not Windows without Cygwin.
gulp.task('untar-opencv', shell.task([
	'tar -xvf ' + filename + '.' + extension + ' -C ' + build
]));

gulp.task('unzip-opencv', shell.task([
	'unzip ' + filename + '.' + extension + ' -d ' + build
]));

gulp.task('cmake-opencv', shell.task([
	'cd ' + build + '; cmake -D CMAKE_BUILD_TYPE=RELEASE -D BUILD_SHARED_LIBS=NO -D CMAKE_INSTALL_PREFIX=./opencv opencv-' + filename + '/'
]));

gulp.task('make-opencv', shell.task([
	'cd ' + build + '; make && make install'
]));

gulp.task('npm-opencv', shell.task([
	'cd ./build; mkdir opencv_example; PKG_CONFIG_PATH=/home/ec2-user/aws-lambda-opencv/opencv/lib/pkgconfig/ npm install --prefix=./opencv_example opencv'
]));

gulp.task('copy-opencv', function() {
	return gulp.src(['./node_modules/opencv/**/*'])
		.pipe(gulp.dest('./dist/node_modules/opencv'));
});

gulp.task('copy-haarcascade', function() {
	return gulp.src(['node_modules/opencv/data/haarcascade_frontalface_alt.xml'])
		.pipe(gulp.dest('./dist/'));
});

/*
 From: https://medium.com/@AdamRNeary/a-gulp-workflow-for-amazon-lambda-61c2afd723b6
 */

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

var cloudFormation = new AWS.CloudFormation();
var packageInfo = require('./package.json');
var bucket = config.functionBucket;
var functionName = packageInfo.name;
var key = functionName + '.zip';

// Upload the function code to S3
gulp.task('upload', function(cb) {
	s3.upload({
		Bucket: bucket,
		Key: key,
		Body: fs.createReadStream('./dist.zip')
	}, cb);
});

var stackName = packageInfo.name;

// Deploy the CloudFormation Stack
gulp.task('deployStack', function(cb) {
	cloudFormation.describeStacks({
		StackName: stackName
	}, function(err) {
		var operation = err ? 'createStack' : 'updateStack';

		cloudFormation[operation]({
			StackName: stackName,
			Capabilities: [
				'CAPABILITY_IAM'
			],
			Parameters: [
				{
					ParameterKey: 'SourceBucketName',
					ParameterValue: config.sourceBucket
				},
				{
					ParameterKey: 'DestinationBucketName',
					ParameterValue: config.destinationBucket
				},
				{
					ParameterKey: 'LambdaS3Bucket',
					ParameterValue: bucket
				},
				{
					ParameterKey: 'LambdaS3Key',
					ParameterValue: key
				}
			],
			TemplateBody: fs.readFileSync('./cloudformation.json', {encoding: 'utf8'})
		}, cb);
	});
});

gulp.task('upload', function() {

  var lambda = new AWS.Lambda();
  var functionName = 'aws-lamda-opencv-face-detection';

  lambda.getFunction({FunctionName: functionName}, function(err, data) {
    if (err) {
      if (err.statusCode === 404) {
        var warning = 'Unable to find lambda function ' + deploy_function + '. '
        warning += 'Verify the lambda function name and AWS region are correct.'
        gutil.log(warning);
      } else {
        var warning = 'AWS API request failed. '
        warning += 'Check your AWS credentials and permissions.'
        gutil.log(warning);
      }
    }

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
		['upload'],		
		cb
	);
});
