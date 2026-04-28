import * as core from '@actions/core';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import axios from 'axios';
import { github, nuget, pdfsharp } from './downloaders';
import LGPL30orlater from './licenses/LGPL-3.0-or-later';

type Settings = {
	output: string;
	projectFilePath: string;
	baseDirectory: string;
	failOnMissingLicense: boolean;
	ignore: string[];
};

type Package = {
	id: string;
	version: string;
};

type LicenseInformation = {
	package: Package;
	licenseUrl?: string;
	license?: string;
	licenseType?: string;
};

async function action() {
	const projectFilePath = core.getInput('path');
	const outputPath = core.getInput('output');
	const baseDirectory = process.env.GITHUB_WORKSPACE as string;
	const failOnMissingLicense = core.getBooleanInput('fail');
	const ignore = core.getInput('ignore').split(',');
	core.debug(`Ignore: ${core.getInput('ignore')}`);
	const settings: Settings = {
		output: outputPath,
		projectFilePath: projectFilePath,
		baseDirectory: baseDirectory,
		failOnMissingLicense: failOnMissingLicense,
		ignore: ignore,
	};
	core.debug(JSON.stringify(settings));
	await main(settings);
}

action();

async function main({ baseDirectory, output, projectFilePath, failOnMissingLicense, ignore }: Settings) {
	console.log(chalk.hex('#33cc33')('Extracting dependencies & their version from project file...'));
	// Get all depedenencies with version
	const projectFile = fs.readFileSync(path.join(baseDirectory, projectFilePath), 'utf8');
	core.debug(`Project file: ${projectFile}`);
	const parser = new XMLParser({ ignoreAttributes: false });
	const projectFileJson = parser.parse(projectFile);
	core.debug(`Project file json: ${JSON.stringify(projectFileJson)}`);
	const packages = projectFileJson.packages.package;
	core.debug(`Packages: ${JSON.stringify(packages)}`);
	// biome-ignore lint/suspicious/noExplicitAny: We don't know the type of the packages, so we have to use any here.
	const parsedPackages = packages.map((p: any) => {
		return { id: p['@_id'], version: correctVersion(p['@_version']) } as Package;
	});
	core.debug(`Parsed packages: ${JSON.stringify(parsedPackages)}`);
	console.log(chalk.hex('#33cc33')(`Found ${parsedPackages.length} dependencies`));
	// Check NuGet API for license information
	console.log(chalk.hex('#33cc33')('Checking NuGet API for license field...'));
	const packagesWithLicense: LicenseInformation[] = [];
	for (const p of parsedPackages) {
		if (ignore.includes(p.id.toLowerCase())) {
			console.log(chalk.hex('#11aa11')(`Ignoring ${p.id}`));
			continue;
		}
		const nugetApiUrl = `https://api.nuget.org/v3-flatcontainer/${p.id.toLowerCase()}/${
			p.version
		}/${p.id.toLowerCase()}.nuspec`;
		core.debug(`NuGet API URL: ${nugetApiUrl}`);
		const response = await axios.get(nugetApiUrl);
		const json = parser.parse(response.data);
		core.debug(`NuGet API response: ${JSON.stringify(json)}`);
		const licenseInformation: LicenseInformation = {
			package: p,
		};
		if (json.package.metadata.license) {
			licenseInformation.license = json.package.metadata.license['#text'];
			licenseInformation.licenseType = json.package.metadata.license['@_type'];
		}
		if (json.package.metadata.licenseUrl) {
			licenseInformation.licenseUrl = json.package.metadata.licenseUrl;
		}
		packagesWithLicense.push(licenseInformation);
	}
	core.debug(`License information: ${JSON.stringify(packagesWithLicense)}`);
	// Download license file
	console.log(chalk.hex('#33cc33')('Downloading license files...'));
	for (const p of packagesWithLicense) {
		if (p.licenseUrl) {
			const licenseDomain = p.licenseUrl.split('/')[2];
			let license = '';
			// WHY WOULD SOMEONE SET THIS AS THEIR LICENSE URL!??!?!!??!
			if (p.licenseUrl === 'https://aka.ms/deprecateLicenseUrl') {
				if (p.package.id.toLowerCase() === 'epplus') {
					// Anubis will weigh your soul and find it lacking
					// Write license to file
					const licenseFileName = `${p.package.id}-${p.package.version}.txt`;
					const licenseFilePath = path.join(output, licenseFileName);
					// Create missing directories
					if (!fs.existsSync(output)) {
						fs.mkdirSync(output);
					}
					fs.writeFileSync(licenseFilePath, LGPL30orlater);
				}
				continue;
			}
			switch (licenseDomain) {
				case 'github.com': {
					license = await github(p.licenseUrl);
					break;
				}
				case 'licenses.nuget.org': {
					license = await nuget(p.licenseUrl, failOnMissingLicense);
					break;
				}
				case 'www.pdfsharp.net': {
					license = pdfsharp();
					break;
				}
				default:
					console.log(
						chalk.hex('#ff0000')(`Unable to fetch license from domain ${licenseDomain} for package ${p.package.id}`)
					);
					if (failOnMissingLicense) {
						core.setFailed(`Unable to fetch license from domain ${licenseDomain} for package ${p.package.id}`);
						process.exit(core.ExitCode.Failure);
					}
			}
			// Write license to file
			const licenseFileName = `${p.package.id}-${p.package.version}.txt`;
			const licenseFilePath = path.join(output, licenseFileName);
			// Create missing directories
			if (!fs.existsSync(output)) {
				fs.mkdirSync(output);
			}
			fs.writeFileSync(licenseFilePath, license);
		} else {
			console.log(chalk.hex('#ff0000')(`No license URL found for ${p.package.id}`));
			if (failOnMissingLicense) {
				core.setFailed(`No license URL found for ${p.package.id}`);
				process.exit(core.ExitCode.Failure);
			}
		}
	}
	console.log(chalk.hex('#33cc33')('Done!'));
}

/**
 * It seems that version like 1.3 can be downloaded, but are not supported by the NuGet API.
 * This function will try to fix the version to a supported version.
 */
function correctVersion(version: string): string {
	if (version.split('.').length < 3) {
		return correctVersion(`${version}.0`);
	}
	return version;
}
