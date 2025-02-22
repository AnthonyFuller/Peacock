/*
 *     The Peacock Project - a HITMAN server replacement.
 *     Copyright (C) 2021-2022 The Peacock Project Team
 *
 *     This program is free software: you can redistribute it and/or modify
 *     it under the terms of the GNU Affero General Public License as published by
 *     the Free Software Foundation, either version 3 of the License, or
 *     (at your option) any later version.
 *
 *     This program is distributed in the hope that it will be useful,
 *     but WITHOUT ANY WARRANTY; without even the implied warranty of
 *     MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *     GNU Affero General Public License for more details.
 *
 *     You should have received a copy of the GNU Affero General Public License
 *     along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { readFile, writeFile } from "atomically"
import { join } from "path"
import type { ContractSession, GameVersion, UserProfile } from "./types/types"
import { serializeSession, deserializeSession } from "./sessionSerialization"
import { castUserProfile } from "./utils"
import { getConfig } from "./configSwizzleManager"
import { log, LogLevel } from "./loggingInterop"

/**
 * Container for functions that handle file read/writes,
 * which could otherwise break if writing partial data.
 */
class AsyncUserDataGuard {
    private readonly userData: Record<string, UserProfile> = {}
    private readonly dirtyProfiles: Set<string> = new Set()

    getProfile(id: string): UserProfile {
        return this.userData[id]
    }

    addLoadedProfile(id: string, profile: UserProfile): void {
        if (!this.userData[id]) {
            setInterval(() => {
                if (!this.dirtyProfiles.has(id)) {
                    return
                }

                this.dirtyProfiles.delete(id)

                this.write(id)
                    .then(() => undefined)
                    .catch((e) => {
                        log(
                            LogLevel.ERROR,
                            `Failed to write user profile ${id}: ${e}`,
                        )
                    })
            }, 3000).unref()
        }

        this.userData[id] = profile
        // just in case
        this.dirtyProfiles.delete(id)
    }

    markDirty(id: string): void {
        this.dirtyProfiles.add(id)
    }

    private async write(versionedId: string): Promise<void> {
        let path

        const [id, gameVersion] = versionedId.split(".")

        if (["scpc", "h1", "h2"].includes(gameVersion)) {
            path = join("userdata", gameVersion, "users", `${id}.json`)
        } else {
            path = join("userdata", "users", `${id}.json`)
        }

        await writeFile(path, JSON.stringify(this.getProfile(versionedId)))
    }
}

const asyncGuard = new AsyncUserDataGuard()

/**
 * Gets a user's profile data.
 *
 * @param userId The user's ID.
 * @param gameVersion The game's version.
 * @returns The user's profile
 */
export function getUserData(
    userId: string,
    gameVersion: GameVersion,
): UserProfile {
    const data = asyncGuard.getProfile(`${userId}.${gameVersion}`)

    // we may not have this profile
    if (data?.Extensions?.gamepersistentdata?.PersistentBool) {
        data.Extensions.gamepersistentdata.PersistentBool = {
            ...data.Extensions.gamepersistentdata.PersistentBool,
            ...getConfig("PersistentBools", true),
        }
    }

    return data
}

/**
 * Loads a user's profile data.
 *
 * @param userId The user's ID.
 * @param gameVersion The game's version.
 * @returns The raw JSON data.
 */
export async function loadUserData(
    userId: string,
    gameVersion: GameVersion,
): Promise<UserProfile> {
    let path

    if (["scpc", "h1", "h2"].includes(gameVersion)) {
        path = join("userdata", gameVersion, "users", `${userId}.json`)
    } else {
        path = join("userdata", "users", `${userId}.json`)
    }

    const userProfile = castUserProfile(
        JSON.parse((await readFile(path)).toString()),
    )

    asyncGuard.addLoadedProfile(`${userId}.${gameVersion}`, userProfile)
    return userProfile
}

/**
 * Marks a user's profile as dirty.
 * Dirty profiles are automatically saved by a background thread every 3 seconds.
 *
 * @param userId The user's ID.
 * @param gameVersion The game's version.
 */
export function writeUserData(userId: string, gameVersion: GameVersion): void {
    asyncGuard.markDirty(`${userId}.${gameVersion}`)
}

/**
 * Writes a previously-non existent user profile.
 * This is used for creating new profiles.
 *
 * @param userId The user's ID.
 * @param userProfile
 * @param gameVersion The game's version.
 */
export function writeNewUserData(
    userId: string,
    userProfile: UserProfile,
    gameVersion: GameVersion,
): void {
    asyncGuard.addLoadedProfile(`${userId}.${gameVersion}`, userProfile)
    asyncGuard.markDirty(`${userId}.${gameVersion}`)
}

/**
 * Gets the value of an external provider binding.
 *
 * @param userId The user's ID.
 * @param externalFolder The folder where this provider's users are stored.
 * @param gameVersion The game's version.
 */
export async function getExternalUserData(
    userId: string,
    externalFolder: string,
    gameVersion: GameVersion,
): Promise<string> {
    if (["scpc", "h1", "h2"].includes(gameVersion)) {
        return (
            await readFile(
                join("userdata", gameVersion, externalFolder, `${userId}.json`),
            )
        ).toString()
    }

    return (
        await readFile(join("userdata", externalFolder, `${userId}.json`))
    ).toString()
}

/**
 * Writes the value of an external provider binding.
 *
 * @param userId The user's ID.
 * @param externalFolder The folder where this provider's users are stored.
 * @param userData The data to write to the binding.
 * @param gameVersion The game's version.
 */
export async function writeExternalUserData(
    userId: string,
    externalFolder: string,
    userData: string,
    gameVersion: GameVersion,
): Promise<void> {
    if (["scpc", "h1", "h2"].includes(gameVersion)) {
        return await writeFile(
            join("userdata", gameVersion, externalFolder, `${userId}.json`),
            userData,
        )
    }

    return await writeFile(
        join("userdata", externalFolder, `${userId}.json`),
        userData,
    )
}

/**
 * Reads a contract session from the contractSessions folder.
 *
 * @param sessionId The ID of the session to load.
 * @returns The contract session.
 */
export async function getContractSession(
    sessionId: string,
): Promise<ContractSession> {
    return deserializeSession(
        JSON.parse(
            (
                await readFile(join("contractSessions", `${sessionId}.json`))
            ).toString(),
        ),
    )
}

/**
 * Writes a contract session to the contractsSessions folder.
 *
 * @param sessionId The session's ID.
 * @param session The contract session.
 */
export async function writeContractSession(
    sessionId: string,
    session: ContractSession,
): Promise<void> {
    return await writeFile(
        join("contractSessions", `${sessionId}.json`),
        JSON.stringify(serializeSession(session)),
    )
}
