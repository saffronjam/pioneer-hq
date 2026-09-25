package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"sigs.k8s.io/yaml"
)

func SetupEnvironment(appMode string) error {
	makeError := func(err error) error {
		return fmt.Errorf("failed to set up environment. details: %w", err)
	}

	configPath, ok := os.LookupEnv("PIONEER_HQ_API_CONFIG_FILE")
	if !ok || configPath == "" {
		configPath = "config.local.yml"
	}

	yamlFile, err := os.ReadFile(configPath)
	if err != nil {
		return makeError(err)
	}

	err = yaml.Unmarshal(yamlFile, &Config)
	if err != nil {
		return makeError(err)
	}

	Config.Mode = appMode
	Config.Filepath = configPath

	if externalURL := os.Getenv("PIONEER_HQ_EXTERNAL_URL"); externalURL != "" {
		Config.ExternalURL = externalURL
		fmt.Printf("Using external URL from PIONEER_HQ_EXTERNAL_URL: %s\n", externalURL)
	}

	// Load port override from environment
	if portStr := os.Getenv("PIONEER_HQ_API_PORT"); portStr != "" {
		port, err := strconv.Atoi(portStr)
		if err != nil {
			return makeError(fmt.Errorf("invalid PIONEER_HQ_API_PORT: %w", err))
		}
		Config.Port = port
		fmt.Printf("Using custom API port from PIONEER_HQ_API_PORT: %d\n", port)
	}

	if maxSampleDurationStr := os.Getenv("PIONEER_HQ_MAX_SAMPLE_GAME_DURATION"); maxSampleDurationStr != "" {
		maxSampleDuration, err := strconv.ParseInt(maxSampleDurationStr, 10, 64)
		if err != nil {
			return makeError(fmt.Errorf("invalid PIONEER_HQ_MAX_SAMPLE_GAME_DURATION: %w", err))
		}
		if maxSampleDuration <= 0 {
			return makeError(fmt.Errorf("PIONEER_HQ_MAX_SAMPLE_GAME_DURATION must be a positive integer, got: %d", maxSampleDuration))
		}
		Config.MaxSampleGameDuration = maxSampleDuration
		fmt.Printf("Using max sample game duration from PIONEER_HQ_MAX_SAMPLE_GAME_DURATION: %d seconds\n", maxSampleDuration)
	}

	if dbPath := os.Getenv("PIONEER_HQ_DB_PATH"); dbPath != "" {
		Config.DBPath = dbPath
		fmt.Printf("Using database path from PIONEER_HQ_DB_PATH: %s\n", dbPath)
	}

	if assetsDir := os.Getenv("PIONEER_HQ_ASSETS_DIR"); assetsDir != "" {
		Config.AssetsDir = assetsDir
		fmt.Printf("Using assets directory from PIONEER_HQ_ASSETS_DIR: %s\n", assetsDir)
	}
	if Config.AssetsDir == "" {
		Config.AssetsDir = "/assets"
	}

	if dataDir := os.Getenv("PIONEER_HQ_DATA_DIR"); dataDir != "" {
		Config.DataDir = dataDir
		fmt.Printf("Using data directory from PIONEER_HQ_DATA_DIR: %s\n", dataDir)
	}
	if Config.DataDir == "" {
		Config.DataDir = filepath.Dir(dbPathOrDefault())
	}

	return nil
}

// dbPathOrDefault mirrors pkg/db's fallback so the data directory can be
// derived before the database is opened.
func dbPathOrDefault() string {
	if Config.DBPath != "" {
		return Config.DBPath
	}
	return "pioneer-hq.db"
}
