# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
AIが大量に生成する Diff を快適にレビューするためのツールを作成する

## 方針
- Golang で実装する
- プレゼンテーション層はWebブラウザ

## 参照
- 実行形式は @refs/mo
  - ローカルでサーバー起動
  - Gobin でフロントエンド
- UI実装は @refs/difit を参照する
  - 快適にレビューできるUIを提供