<h1 align="center">Osiris</h1>

_A[^1]_ way to fetch the licenses of NuGet packages in your GitHub action.

## Input

- **path**: The path to your `packages.config` file.
- **output**: The output directory where all the license files will be saved.
- **fail**: Set to true if you want the action to fail if a license can't be found. (default: `false`)
- **ignore**: A comma separated list of ignored packages. For example internal packages that don't have a license.


[^1]: Certainly not the best way.
