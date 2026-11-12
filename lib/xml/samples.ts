// lib/xml/samples.ts — 新建布局的示例骨架（从 components/XmlEditor.tsx 抽出的纯数据）
import { t as tt } from "../i18n-src";

export const SAMPLES: Record<string, string> = {
  /** M2s：新建空白 ConstraintLayout 骨架（一行注释 + 空 CL，拖控件进来即可开建） */
  "blank-cl": `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

  <!-- ${tt("从左侧「组件」把控件拖进来，或选中后在右侧加约束")} -->

</androidx.constraintlayout.widget.ConstraintLayout>
`,
  /** M2s：新建空白 LinearLayout（竖） */
  "blank-ll": `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">

  <!-- ${tt("从左侧「组件」把控件拖进来")} -->

</LinearLayout>
`,
  /** M2s：新建空白 FrameLayout */
  "blank-frame": `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

  <!-- ${tt("从左侧「组件」把控件拖进来")} -->

</FrameLayout>
`,
  cl: `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#FFFFFF">

  <TextView
      android:id="@+id/tvTitle"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_marginStart="16dp"
      android:layout_marginTop="24dp"
      android:text="${tt("约束布局示例")}"
      android:textSize="20sp"
      android:textStyle="bold"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toTopOf="parent" />

  <TextView
      android:id="@+id/tvSub"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_marginStart="16dp"
      android:layout_marginTop="8dp"
      android:text="${tt("选中控件后在右侧编辑四条边的约束")}"
      android:textColor="#6B7280"
      android:textSize="13sp"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toBottomOf="@+id/tvTitle" />

  <View
      android:id="@+id/bar"
      android:layout_width="0dp"
      android:layout_height="120dp"
      android:layout_marginStart="16dp"
      android:layout_marginTop="20dp"
      android:layout_marginEnd="16dp"
      android:background="#E8EEFA"
      app:layout_constraintEnd_toEndOf="parent"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toBottomOf="@+id/tvSub" />

  <Button
      android:id="@+id/btnOk"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_marginEnd="16dp"
      android:layout_marginBottom="24dp"
      android:text="${tt("确定")}"
      app:layout_constraintBottom_toBottomOf="parent"
      app:layout_constraintEnd_toEndOf="parent" />

  <TextView
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:text="${tt("我没约束（选中我点「自动约束」）")}"
      android:textSize="13sp" />

</androidx.constraintlayout.widget.ConstraintLayout>`,
  chain: `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#FFFFFF">

  <TextView
      android:id="@+id/tvHead"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_marginStart="16dp"
      android:layout_marginTop="24dp"
      android:text="${tt("chain 链式排布 + Guideline")}"
      android:textSize="18sp"
      android:textStyle="bold"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toTopOf="parent" />

  <androidx.constraintlayout.widget.Guideline
      android:id="@+id/guide10"
      android:orientation="horizontal"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      app:layout_constraintGuide_percent="0.12" />

  <Button
      android:id="@+id/b1"
      android:layout_width="0dp"
      android:layout_height="wrap_content"
      android:text="${tt("一")}"
      app:layout_constraintHorizontal_chainStyle="spread"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintEnd_toStartOf="@+id/b2"
      app:layout_constraintTop_toBottomOf="@+id/guide10"
      android:layout_marginStart="16dp"
      android:layout_marginEnd="8dp" />

  <Button
      android:id="@+id/b2"
      android:layout_width="0dp"
      android:layout_height="wrap_content"
      android:text="${tt("二")}"
      app:layout_constraintStart_toEndOf="@+id/b1"
      app:layout_constraintEnd_toStartOf="@+id/b3"
      app:layout_constraintTop_toTopOf="@+id/b1"
      android:layout_marginStart="8dp"
      android:layout_marginEnd="8dp" />

  <Button
      android:id="@+id/b3"
      android:layout_width="0dp"
      android:layout_height="wrap_content"
      android:text="${tt("三")}"
      app:layout_constraintStart_toEndOf="@+id/b2"
      app:layout_constraintEnd_toEndOf="parent"
      app:layout_constraintTop_toTopOf="@+id/b1"
      android:layout_marginStart="8dp"
      android:layout_marginEnd="16dp" />

  <TextView
      android:id="@+id/tvNote"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_marginTop="24dp"
      android:text="${tt("三个 0dp 按钮在 spread 链里平分宽度")}"
      android:textSize="13sp"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toBottomOf="@+id/b1" />

</androidx.constraintlayout.widget.ConstraintLayout>`,
  barrier: `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#FFFFFF">

  <TextView
      android:id="@+id/tvL"
      android:layout_width="120dp"
      android:layout_height="wrap_content"
      android:layout_marginStart="16dp"
      android:layout_marginTop="24dp"
      android:text="${tt("左边一段较长的说明文字，会把高度撑高")}"
      android:textSize="14sp"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toTopOf="parent" />

  <TextView
      android:id="@+id/tvR"
      android:layout_width="120dp"
      android:layout_height="wrap_content"
      android:layout_marginStart="16dp"
      android:layout_marginTop="24dp"
      android:text="${tt("右边短")}"
      android:textSize="14sp"
      app:layout_constraintStart_toEndOf="@+id/tvL"
      app:layout_constraintTop_toTopOf="parent" />

  <androidx.constraintlayout.widget.Barrier
      android:id="@+id/barBottom"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      app:barrierDirection="bottom"
      app:constraint_referenced_ids="tvL,tvR" />

  <Button
      android:id="@+id/btnBelow"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_marginTop="16dp"
      android:text="${tt("我跟着较高的那个往下排")}"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toBottomOf="@+id/barBottom" />

</androidx.constraintlayout.widget.ConstraintLayout>`,
  list: `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:background="@color/card_bg"
    android:padding="16dp">

  <TextView
      android:id="@+id/tvTitle"
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:text="@string/app_name"
      android:textSize="18sp"
      android:textStyle="bold"/>

  <View
      android:layout_width="match_parent"
      android:layout_height="1dp"
      android:layout_marginTop="8dp"
      android:background="@color/divider"/>

  <TextView
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:layout_marginTop="16dp"
      android:padding="12dp"
      android:text="${tt("项目一")}"/>

  <Button
      android:id="@+id/btnConfirm"
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:layout_marginTop="24dp"
      android:text="@string/button_ok"
      android:background="@color/primary"
      android:textColor="@color/white"/>
</LinearLayout>`,
};
